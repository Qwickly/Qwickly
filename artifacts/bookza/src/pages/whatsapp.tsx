import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getGetWhatsappConversationsQueryKey,
  buildApiUrl,
  type WhatsappConversation,
  type WhatsappMessage,
  useGetWhatsappConversations,
  useMarkWhatsappConversationRead,
  useSendWhatsappConversationMessage,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Loader2,
  MessageSquare,
  Bot,
  Search,
  UserCircle2,
  Send,
  Plus,
  Clock,
  Check,
  CheckCheck,
  AlertCircle,
  Unplug,
  Copy,
  X,
  Lock,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  InfoTile,
  PageEmptyState,
  PageHeader,
  PageOverflowMenu,
} from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { ConnectionStatusBadge } from "@/components/ui/status-badge";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  getCachedConversations,
  setCachedConversations,
  getCachedMessages,
  setCachedMessages,
} from "@/lib/whatsapp-cache";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { useEntitlements } from "@/hooks/use-entitlements";
import { ChatPageSkeleton } from "@/components/skeletons/page-skeletons";

type WhatsappAiDraft = {
  id: string;
  remoteJid: string;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  inboundMessageText: string;
  suggestedReply: string;
  proposedActions: Array<Record<string, unknown>>;
  status: string;
  createdAt: string;
};

const MESSAGE_BATCH_SIZE = 25;
const MAX_MESSAGE_LIMIT = 500;

function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2 sm:p-3">
      {Array.from({ length: rows }).map((_, index) => (
        <InfoTile key={index} className="flex items-start gap-3 p-3 sm:p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full sm:h-12 sm:w-12" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </InfoTile>
      ))}
    </div>
  );
}

function MessagePaneSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, index) => {
        const inbound = index % 2 === 0;
        return (
          <div key={index} className={cn("flex gap-3", inbound ? "justify-start" : "justify-end")}>
            {inbound ? <Skeleton className="h-9 w-9 shrink-0 rounded-full self-end" /> : null}
            <div className={cn("space-y-2 rounded-2xl p-3", inbound ? "w-2/3 bg-muted" : "w-3/5 bg-primary/10")}>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className={cn("h-2.5 w-20", inbound ? "" : "ml-auto")} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function normalizeWhatsappIdentity(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

/**
 * Does this drafted reply belong to this conversation?
 *
 * Drafts are produced by the assistant against a WhatsApp remote JID, which
 * does not always line up with a conversation row: the client may have been
 * created after the draft, or stored with a differently formatted number. So
 * this tries the reliable identifiers first and falls back to a suffix match on
 * the digits, which is what survives country-code and leading-zero differences.
 */
function draftMatchesConversation(
  draft: WhatsappAiDraft,
  conversation: WhatsappConversation,
): boolean {
  const convRemoteJid = (conversation as { remoteJid?: string | null }).remoteJid
    ?.trim()
    .toLowerCase();
  const convPhone = normalizeWhatsappIdentity(conversation.clientPhone || convRemoteJid);
  const convName = conversation.clientName?.trim().toLowerCase();
  const convClientId = conversation.clientId;

  const draftRemoteJid = draft.remoteJid?.trim().toLowerCase();
  const draftPhone = normalizeWhatsappIdentity(draft.clientPhone || draft.remoteJid);
  const draftName = draft.clientName?.trim().toLowerCase();

  if (convRemoteJid && draftRemoteJid && convRemoteJid === draftRemoteJid) return true;
  if (
    convClientId != null &&
    draft.clientId != null &&
    String(draft.clientId) === String(convClientId)
  ) {
    return true;
  }
  if (convPhone && draftPhone) {
    return convPhone.endsWith(draftPhone) || draftPhone.endsWith(convPhone);
  }

  return Boolean(convName && draftName && convName === draftName);
}

async function fetchWhatsappMessages(
  conversationId: number,
  limit: number,
): Promise<WhatsappMessage[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const response = await fetch(
    buildApiUrl(`/api/whatsapp/conversations/${conversationId}/messages?limit=${limit}`),
    {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Could not load WhatsApp messages");
  }

  return response.json() as Promise<WhatsappMessage[]>;
}

async function fetchWhatsappAiDrafts(): Promise<WhatsappAiDraft[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const response = await fetch(buildApiUrl("/api/whatsapp/ai-drafts?limit=25"), {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Could not load AI drafts");
  }

  const payload = await response.json();
  return (payload?.drafts ?? []) as WhatsappAiDraft[];
}

/** One row in the conversation list. */
function ConversationRow({
  conversation,
  selected,
  hasPendingDraft,
  onSelect,
}: {
  conversation: WhatsappConversation;
  selected: boolean;
  /** The assistant has drafted a reply on this chat and is waiting on a human. */
  hasPendingDraft: boolean;
  onSelect: () => void;
}) {
  const unread = conversation.unreadCount > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary/30 bg-primary/5"
          : "border-transparent hover:bg-muted/40",
      )}
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={conversation.avatarUrl || undefined} />
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {conversation.clientName.substring(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {conversation.clientName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(new Date(conversation.lastMessageAt), "HH:mm")}
          </span>
        </div>

        <p
          className={cn(
            "mt-0.5 line-clamp-1 text-xs",
            unread ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {conversation.lastMessage}
        </p>

        {(conversation.isBot || hasPendingDraft) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/*
              Surfaced on the row, not just inside the thread. A drafted reply
              waiting on approval is the one thing on this page that needs a
              human, and it used to be invisible until you opened the chat.
            */}
            {hasPendingDraft && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-400"
              >
                <Clock className="h-3 w-3" />
                Reply waiting
              </Badge>
            )}
            {conversation.isBot && (
              <Badge
                variant="outline"
                className="gap-1 border-primary/20 bg-primary/10 px-1.5 py-0 text-[0.6875rem] font-medium text-primary"
              >
                <Bot className="h-3 w-3" />
                Bot
              </Badge>
            )}
          </div>
        )}
      </div>

      {unread && (
        <Badge className="mt-0.5 h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-xs tabular-nums">
          {conversation.unreadCount}
        </Badge>
      )}
    </button>
  );
}

/** A sent or received message. */
function MessageBubble({
  message,
  status,
}: {
  message: WhatsappMessage;
  /** Delivery ticks. Outbound only — there is nothing to report on a message we received. */
  status: ReactNode;
}) {
  const inbound = message.direction === "inbound";

  return (
    <div className={cn("flex gap-2", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[75%]",
          inbound
            ? "rounded-bl-sm border border-border/60 bg-card text-foreground"
            : "rounded-br-sm bg-primary text-primary-foreground",
        )}
      >
        <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-xs",
            inbound
              ? "text-muted-foreground"
              : "justify-end text-primary-foreground/75",
          )}
        >
          <span>{format(new Date(message.timestamp), "d MMM, HH:mm")}</span>
          {!inbound && status}
        </p>
      </div>
    </div>
  );
}

export default function WhatsAppPage({ conversationId }: { conversationId?: string }) {
  const [, navigate] = useLocation();

  /**
   * The open chat, read from the URL rather than held in state.
   *
   * One source of truth: the address bar. Selection used to be useState, which
   * meant opening a chat pushed no history entry — Back left /whatsapp for the
   * previous page instead of returning to the list, and the breadcrumb kept
   * naming a chat the browser had no idea was open.
   */
  const selectedConversationId = useMemo(() => {
    const parsed = Number(conversationId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [conversationId]);

  const openConversation = (id: number) => navigate(`/whatsapp/${id}`);
  const closeConversation = () => navigate("/whatsapp");

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  // WhatsApp messaging (inbox, connection, reminders, campaigns) is part of the
  // base plan in the current model — it unlocks for any live subscription that
  // includes whatsappSession. The AI chatbot is a separate add-on gated server-
  // side. This used to read a metadata.whatsappEnabled flag that no longer exists
  // on any plan, so the page was locked for everyone.
  const { data: entitlements, isLoading: loadingEntitlements } = useEntitlements();
  const whatsappEnabled = Boolean(entitlements?.entitled && entitlements.whatsappSession);
  const hasChatbot = Boolean(entitlements?.grants?.whatsapp_chatbot);

  const queryClient = useQueryClient();
  // `mobileView` used to live here as its own piece of state. It is gone: on a
  // phone you are looking at the thread exactly when a conversation is open, so
  // it was a second thing that could disagree with the first — and did, which is
  // how the old back arrow could return you to the list while the breadcrumb
  // still named a chat.
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [newChatPhone, setNewChatPhone] = useState("");
  const [newChatMessage, setNewChatMessage] = useState("");
  const [showNewChatForm, setShowNewChatForm] = useState(false);
  const [creatingNewChat, setCreatingNewChat] = useState(false);
  const [messageLimit, setMessageLimit] = useState(MESSAGE_BATCH_SIZE);
  const messagePaneRef = useRef<HTMLDivElement | null>(null);
  const previousScrollHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const {
    connection,
    connected,
    loading: loadingConnection,
    disconnecting,
    disconnect,
  } = useWhatsappConnection();


  const { data: conversations, isLoading: loadingConversations } =
    useGetWhatsappConversations({
      query: {
        queryKey: getGetWhatsappConversationsQueryKey(),
        refetchInterval: connected ? 10_000 : false,
        initialData: getCachedConversations<WhatsappConversation[]>(),
      },
    });

  const { data: aiDrafts = [] } = useQuery({
    queryKey: ["whatsapp-ai-drafts"],
    queryFn: fetchWhatsappAiDrafts,
    // Poll for pending AI drafts while connected; the queue only shows when any exist.
    refetchInterval: connected ? 10_000 : false,
  });
  const [approvingDraftId, setApprovingDraftId] = useState<string | null>(null);
  const [dismissingDraftId, setDismissingDraftId] = useState<string | null>(null);

  useEffect(() => {
    if (Array.isArray(conversations)) {
      setCachedConversations(conversations);
    }
  }, [conversations]);
  const selectedConv =
    Array.isArray(conversations)
      ? conversations.find((conv) => conv.id === selectedConversationId) ?? null
      : null;
  const {
    data: messages,
    isLoading: loadingMessages,
    isFetching: fetchingMessages,
  } = useQuery({
    queryKey: ["whatsapp-messages", selectedConv?.id, messageLimit],
    queryFn: () => fetchWhatsappMessages(selectedConv!.id, messageLimit),
    enabled: Boolean(selectedConv),
    refetchInterval: selectedConv && connected ? 7_500 : false,
    initialData: selectedConv
      ? getCachedMessages<WhatsappMessage[]>(selectedConv.id)
      : undefined,
  });

  useEffect(() => {
    if (messages && selectedConv) {
      setCachedMessages(selectedConv.id, messages);
    }
  }, [messages, selectedConv]);
  const sendMessage = useSendWhatsappConversationMessage();
  const markRead = useMarkWhatsappConversationRead();
  const markReadMutate = markRead.mutate;
  const markingRead = markRead.isPending;
  const canLoadMoreMessages = Boolean(
    messages &&
    messages.length >= messageLimit &&
    messageLimit < MAX_MESSAGE_LIMIT,
  );
  const selectedChatDrafts = useMemo(
    () =>
      selectedConv
        ? aiDrafts.filter((draft) => draftMatchesConversation(draft, selectedConv))
        : [],
    [aiDrafts, selectedConv],
  );

  /**
   * Conversations with a reply waiting on approval.
   *
   * The list marks these. A drafted reply is the only thing on this page that
   * actually needs a person, and it used to be invisible until you happened to
   * open the right chat — the queue lived in a separate card above the grid
   * instead of being attached to the conversations it belonged to.
   */
  const draftConversationIds = useMemo(() => {
    const ids = new Set<number>();
    if (!Array.isArray(conversations)) return ids;

    for (const conv of conversations) {
      if (aiDrafts.some((draft) => draftMatchesConversation(draft, conv))) {
        ids.add(conv.id);
      }
    }
    return ids;
  }, [aiDrafts, conversations]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = Array.isArray(conversations) ? conversations : [];
    if (!query) return list;

    return list.filter((conv) =>
      [conv.clientName, conv.clientPhone, conv.lastMessage]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  // Nothing is opened for you. This used to select the first conversation the
  // moment the page loaded, which WhatsApp itself does not do — and because the
  // effect below marks the open chat as read, merely visiting the page marked
  // somebody's newest messages as read without anyone choosing to open them.
  //
  // Selection is only ever CLEARED here, and only when the chat has genuinely
  // gone from the account. Deliberately keyed on the full list rather than the
  // filtered one: typing in the search box should not close the chat you are
  // reading.
  useEffect(() => {
    if (!Array.isArray(conversations)) return;
    if (selectedConversationId == null) return;
    if (conversations.some((conv) => conv.id === selectedConversationId)) return;

    closeConversation();
    // `closeConversation` is a stable navigate() wrapper; including it would
    // only re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    setReplyText("");
    setMessageLimit(MESSAGE_BATCH_SIZE);
    loadingOlderRef.current = false;
    previousScrollHeightRef.current = 0;
  }, [selectedConversationId]);

  useLayoutEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane || !messages) return;

    if (loadingOlderRef.current) {
      const previousHeight = previousScrollHeightRef.current;
      pane.scrollTop = Math.max(pane.scrollHeight - previousHeight, 0);
      loadingOlderRef.current = false;
      return;
    }

    pane.scrollTop = pane.scrollHeight;
  }, [messages, selectedConversationId, selectedChatDrafts.length]);

  useEffect(() => {
    if (!selectedConv || selectedConv.unreadCount <= 0 || markingRead) {
      return;
    }

    markReadMutate(
      { id: selectedConv.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetWhatsappConversationsQueryKey(),
          });
        },
      },
    );
  }, [markReadMutate, markingRead, queryClient, selectedConv]);

  const handleSendReply = () => {
    const message = replyText.trim();
    if (!selectedConv || !message || sendMessage.isPending) return;

    sendMessage.mutate(
      { id: selectedConv.id, data: { message } },
      {
        onSuccess: () => {
          setReplyText("");
          void queryClient.invalidateQueries({
            queryKey: getGetWhatsappConversationsQueryKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: ["whatsapp-messages", selectedConv.id],
          });
        },
        onError: (error) => {
          toast.error("Could not send message", { description: error instanceof Error
                ? error.message
                : "Please check the WhatsApp connection and try again." });
        },
      },
    );
  };

  const handleCreateNewChat = async () => {
    const phone = newChatPhone.trim();
    const message = newChatMessage.trim();
    if (!connected || creatingNewChat || !phone || !message) return;

    try {
      setCreatingNewChat(true);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(buildApiUrl(`/api/whatsapp/contacts/messages`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ phone, message }),
      });

      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "Failed to send WhatsApp message.");

      setNewChatPhone("");
      setNewChatMessage("");
      setShowNewChatForm(false);
      toast("Message sent", { description: "Your message was delivered or queued for delivery." });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
      if (payload?.conversationId) {
        openConversation(payload.conversationId);
      }
    } catch (error) {
      toast.error("Could not send message", { description: error instanceof Error
            ? error.message
            : "Please check the WhatsApp connection and try again." });
    } finally {
      setCreatingNewChat(false);
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    if (approvingDraftId) return;

    try {
      setApprovingDraftId(draftId);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(buildApiUrl(`/api/whatsapp/ai-drafts/${draftId}/approve`), {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not approve draft.");
      }

      toast("AI reply sent", { description: "The approved WhatsApp response has been sent." });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-ai-drafts"] });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
      if (selectedConv) {
        void queryClient.invalidateQueries({
          queryKey: ["whatsapp-messages", selectedConv.id],
        });
      }
    } catch (error) {
      toast.error("Could not approve draft", { description: error instanceof Error ? error.message : "Please try again shortly." });
    } finally {
      setApprovingDraftId(null);
    }
  };

  const handleDismissDraft = async (draftId: string) => {
    if (dismissingDraftId) return;

    try {
      setDismissingDraftId(draftId);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(buildApiUrl(`/api/whatsapp/ai-drafts/${draftId}/dismiss`), {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not dismiss draft.");
      }

      toast("Draft dismissed", { description: "The AI response was removed from the approval queue." });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-ai-drafts"] });
    } catch (error) {
      toast.error("Could not dismiss draft", { description: error instanceof Error ? error.message : "Please try again shortly." });
    } finally {
      setDismissingDraftId(null);
    }
  };

  const handleCopyDraft = async (reply: string) => {
    try {
      await navigator.clipboard.writeText(reply);
      toast("Copied", { description: "The suggested reply was copied." });
    } catch {
      toast.error("Could not copy", { description: "Your browser blocked clipboard access." });
    }
  };

  const handleDisconnectWhatsapp = async () => {
    if (
      !confirm(
        "Disconnect this WhatsApp account from Qwickly? New incoming messages will stop syncing until you reconnect.",
      )
    ) {
      return;
    }

    try {
      await disconnect();
      toast("WhatsApp disconnected", { description: "The saved session was cleared. Reconnect with a QR code when you're ready." });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
    } catch (error) {
      toast.error("Could not disconnect WhatsApp", { description: error instanceof Error ? error.message : "Please try again in a moment." });
    }
  };

  const renderMessageStatus = (status: string) => {
    if (status === "failed") return <AlertCircle className="w-3 h-3" />;
    if (status === "read")
      return <CheckCheck className="w-3 h-3 text-primary-foreground/70" />;
    if (status === "delivered") return <CheckCheck className="w-3 h-3" />;
    return <Check className="w-3 h-3" />;
  };

  const loadMoreMessages = () => {
    if (!canLoadMoreMessages || fetchingMessages) return;

    const pane = messagePaneRef.current;
    previousScrollHeightRef.current = pane?.scrollHeight ?? 0;
    loadingOlderRef.current = true;
    setMessageLimit((current) =>
      Math.min(current + MESSAGE_BATCH_SIZE, MAX_MESSAGE_LIMIT),
    );
  };


  // Registers the trail in the chrome bar. Declared here, above every early
  // return below, because it is a hook — and unconditionally, so the locked and
  // loading states carry the same breadcrumb as the loaded page rather than
  // dropping it and letting the bar collapse under them.
  //
  // Bot Setup declares [WhatsApp → Bot Setup] and links back here, so this page
  // is "WhatsApp". It called itself "WhatsApp Hub", which made three names for
  // one area between the nav item, the breadcrumb and the heading.
  usePageChrome(
    useMemo(
      () => ({
        breadcrumbs: selectedConv
          ? [
              {
                label: "WhatsApp",
                // Back to the list, not a navigation. The parent of an open
                // chat is this same route with nothing selected, so an href
                // would route to the page we are already on and change nothing.
                onClick: closeConversation,
              },
              { label: selectedConv.clientName },
            ]
          : [{ label: "WhatsApp" }],
      }),
      [selectedConv],
    ),
  );

  // Show lock screen if WhatsApp is not enabled. Wait for entitlements too, or the
  // page flashes "locked" for a moment before they load.
  if (loadingSubscription || loadingEntitlements) {
    return <ChatPageSkeleton />;
  }

  if (!whatsappEnabled) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Card className="max-w-md">
          <PageEmptyState
            icon={Lock}
            title="WhatsApp Locked"
            description="WhatsApp automation and inbox is not included in your current plan. Upgrade to access automated confirmations, reminders, and client messaging."
            actions={
              <Button className="w-full" asChild>
                <a href="/billing">
                  Upgrade Plan <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Every conversation with your clients, and what the assistant has replied on your behalf."
        className={cn(
          // On mobile, an open chat should fill the screen so the thread is not pushed down.
          selectedConversationId !== null && "hidden lg:flex",
        )}
        // `badges` and `overflowActions`, not the `actions` escape hatch this
        // page was still using. PageHeader documents `actions` as legacy —
        // pages on it lay their own buttons out, which is how this one ended up
        // with a bespoke icon button where every other page has the shared
        // overflow menu.
        badges={
          <ConnectionStatusBadge status={connection.status} loading={loadingConnection} />
        }
        overflowActions={
          connected ? (
            <PageOverflowMenu label="WhatsApp actions">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDisconnectWhatsapp}
                disabled={disconnecting}
              >
                <Unplug className="mr-2 h-4 w-4" />
                {disconnecting ? "Disconnecting..." : "Disconnect WhatsApp"}
              </DropdownMenuItem>
            </PageOverflowMenu>
          ) : null
        }
      />

      {!loadingConnection && !connected && (
        <Card>
          <PageEmptyState
            icon={Bot}
            title="Connect WhatsApp in Bot Setup"
            description="Pair your number to load conversations, reply from here, and let the assistant answer for you."
            actions={
              <Button asChild>
                <a href="/whatsapp/bot">
                  Open Bot Setup <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            }
          />
        </Card>
      )}

      {connected && (
        <div
          className={cn(
            "grid min-h-0 gap-4",
            "lg:h-[calc(100vh-13rem)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]",
            selectedConversationId
              ? "h-[calc(100dvh-2rem)]"
              : "h-[calc(100vh-13rem)] min-h-[34rem]",
          )}
        >
          {/* ── Conversations ─────────────────────────────────────────── */}
          <Card
            className={cn(
              "min-h-0 flex-col gap-0 overflow-hidden py-0",
              selectedConversationId ? "hidden lg:flex" : "flex",
            )}
          >
            <div className="space-y-3 border-b border-border/60 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Chats</h2>
                {/* The count, once. It used to be printed as prose and again as
                    a badge immediately beside it. */}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {filteredConversations.length}
                </span>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations"
                  className="h-9 pl-9"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loadingConversations ? (
                <ConversationListSkeleton rows={6} />
              ) : filteredConversations.length > 0 ? (
                <div className="space-y-1 p-2">
                  {filteredConversations.map((conv) => (
                    <ConversationRow
                      key={conv.id}
                      conversation={conv}
                      selected={selectedConv?.id === conv.id}
                      hasPendingDraft={draftConversationIds.has(conv.id)}
                      onSelect={() => openConversation(conv.id)}
                    />
                  ))}
                </div>
              ) : (
                <PageEmptyState
                  icon={MessageSquare}
                  title={searchQuery.trim() ? "No matches" : "No conversations yet"}
                  description={
                    searchQuery.trim()
                      ? "No chats match that search."
                      : "Messages from your clients will appear here."
                  }
                  className="h-full min-h-48"
                />
              )}
            </div>

            {/* Outbound-to-new-numbers is gated on Meta approval. Stated once,
                at the bottom of the list, instead of as a card competing with
                the search field for the top of the pane. */}
            <p className="flex items-center gap-2 border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              Starting new chats arrives with the WhatsApp Cloud API upgrade.
            </p>
          </Card>

          {/* ── Thread ────────────────────────────────────────────────── */}
          <Card
            className={cn(
              "min-h-0 flex-col gap-0 overflow-hidden py-0",
              selectedConversationId ? "flex" : "hidden lg:flex",
            )}
          >
            {selectedConv ? (
              <>
                {/*
                  No back arrow here. There was one, mobile-only, beside the
                  avatar — and it only sent the view back to the list without
                  clearing the selection, so the breadcrumb went on saying
                  WhatsApp / Sarah while you were looking at the chat list.

                  The breadcrumb's own "WhatsApp" crumb is the way back now. It
                  renders at every width (the chrome bar is never hidden; only
                  the page heading is, in a mobile thread) and it clears the
                  selection as well as the view, so the trail and the screen
                  agree.
                */}
                <div className="flex items-center gap-3 border-b border-border/60 p-4">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={selectedConv.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                      {selectedConv.clientName.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {selectedConv.clientName}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedConv.clientPhone || "WhatsApp"}
                    </p>
                  </div>

                  {selectedConv.isBot && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-primary/20 bg-primary/10 text-primary"
                    >
                      <Bot className="h-3 w-3" />
                      Assistant on
                    </Badge>
                  )}
                </div>

                <div
                  ref={messagePaneRef}
                  className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-muted/20 p-4"
                  onScroll={(event) => {
                    if (event.currentTarget.scrollTop <= 8) {
                      loadMoreMessages();
                    }
                  }}
                >
                  {loadingMessages ? (
                    <MessagePaneSkeleton />
                  ) : (messages?.length ?? 0) > 0 ? (
                    <>
                      {canLoadMoreMessages && (
                        <div className="flex justify-center pb-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            disabled={fetchingMessages}
                            onClick={loadMoreMessages}
                          >
                            {fetchingMessages ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Load older messages
                          </Button>
                        </div>
                      )}
                      {messages!.map((message) => (
                        <MessageBubble
                          key={`${message.direction}-${message.timestamp}-${message.id}`}
                          message={message}
                          status={renderMessageStatus(message.status)}
                        />
                      ))}
                    </>
                  ) : (
                    <PageEmptyState
                      icon={MessageSquare}
                      title="No messages yet"
                      description="Send a message to start this conversation."
                      className="h-full min-h-48"
                    />
                  )}

                  {/*
                    Drafted replies sit at the end of the thread, in the place
                    the reply itself will occupy, and this is now the ONLY place
                    they can be approved. There used to be a second full set of
                    these controls in a card above the grid.
                  */}
                  {selectedChatDrafts.map((draft) => (
                    <div key={draft.id} className="flex justify-end">
                      <div className="max-w-[85%] space-y-2 sm:max-w-[75%]">
                        <div className="rounded-2xl rounded-br-sm border border-dashed border-primary/40 bg-primary/10 px-3.5 py-2.5 text-sm">
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                            <Bot className="h-3.5 w-3.5" />
                            Suggested reply
                          </p>
                          <p className="leading-relaxed whitespace-pre-wrap text-foreground">
                            {draft.suggestedReply}
                          </p>
                          <p className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(draft.createdAt), "d MMM, HH:mm")}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyDraft(draft.suggestedReply)}
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Copy
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleDismissDraft(draft.id)}
                            disabled={Boolean(dismissingDraftId || approvingDraftId)}
                          >
                            {dismissingDraftId === draft.id ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <X className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Dismiss
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleApproveDraft(draft.id)}
                            disabled={Boolean(approvingDraftId || dismissingDraftId)}
                          >
                            {approvingDraftId === draft.id ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Approve &amp; send
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-end gap-2 border-t border-border/60 p-3">
                  <Textarea
                    placeholder={connected ? "Type a message" : "Connect WhatsApp to reply."}
                    className="max-h-32 min-h-11 flex-1 resize-none text-sm"
                    value={replyText}
                    disabled={!connected || sendMessage.isPending}
                    onChange={(event) => setReplyText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSendReply();
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    disabled={!connected || !replyText.trim() || sendMessage.isPending}
                    onClick={handleSendReply}
                    aria-label="Send message"
                  >
                    {sendMessage.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </>
            ) : (
              /* One empty state, not two. This used to render a fake thread
                 header with a placeholder avatar saying "Select a Conversation"
                 and then an empty state underneath saying it again. */
              <PageEmptyState
                icon={UserCircle2}
                title="No conversation selected"
                description="Pick a chat on the left to read the history and reply."
                className="h-full"
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
