import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getGetWhatsappConversationsQueryKey,
  buildApiUrl,
  type WhatsappConversation,
  type WhatsappMessage,
  useGetWhatsappConversations,
  useMarkWhatsappConversationRead,
  useSendWhatsappConversationMessage,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal,
  Lock,
  ArrowRight,
  ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WhatsappConnectionManager } from "@/components/settings/WhatsappConnectionManager";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { useToast } from "@/hooks/use-toast";
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
        <div key={index} className="flex items-start gap-3 rounded-xl border border-border/45 bg-muted/20 p-3 sm:p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full sm:h-12 sm:w-12" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
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

export default function WhatsAppPage() {
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
  const { toast } = useToast();
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null);
  // Mobile split-view: 'list' shows conversation list, 'chat' shows active chat
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
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
  const selectedChatDrafts = useMemo(() => {
    if (!selectedConv) return [];

    const selectedRemoteJid = (selectedConv as { remoteJid?: string | null }).remoteJid
      ?.trim()
      .toLowerCase();
    const selectedPhone = normalizeWhatsappIdentity(
      selectedConv.clientPhone || selectedRemoteJid,
    );
    const selectedName = selectedConv.clientName?.trim().toLowerCase();
    const selectedClientId = selectedConv.clientId;

    return aiDrafts.filter((draft) => {
      const draftRemoteJid = draft.remoteJid?.trim().toLowerCase();
      const draftPhone = normalizeWhatsappIdentity(draft.clientPhone || draft.remoteJid);
      const draftName = draft.clientName?.trim().toLowerCase();

      if (selectedRemoteJid && draftRemoteJid && selectedRemoteJid === draftRemoteJid) return true;
      if (
        selectedClientId != null &&
        draft.clientId != null &&
        String(draft.clientId) === String(selectedClientId)
      ) {
        return true;
      }
      if (selectedPhone && draftPhone) {
        return selectedPhone.endsWith(draftPhone) || draftPhone.endsWith(selectedPhone);
      }

      return Boolean(selectedName && draftName && selectedName === draftName);
    });
  }, [aiDrafts, selectedConv]);

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

  useEffect(() => {
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
      setMobileView('list');
      return;
    }

    setSelectedConversationId((current) =>
      current && filteredConversations.some((conv) => conv.id === current)
        ? current
        : filteredConversations[0]!.id,
    );
  }, [filteredConversations]);

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
          toast({
            title: "Could not send message",
            description:
              error instanceof Error
                ? error.message
                : "Please check the WhatsApp connection and try again.",
            variant: "destructive",
          });
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
      toast({
        title: "Message sent",
        description: "Your message was delivered or queued for delivery.",
      });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
      if (payload?.conversationId) {
        setSelectedConversationId(payload.conversationId);
      }
    } catch (error) {
      toast({
        title: "Could not send message",
        description:
          error instanceof Error
            ? error.message
            : "Please check the WhatsApp connection and try again.",
        variant: "destructive",
      });
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

      toast({
        title: "AI reply sent",
        description: "The approved WhatsApp response has been sent.",
      });
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
      toast({
        title: "Could not approve draft",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
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

      toast({
        title: "Draft dismissed",
        description: "The AI response was removed from the approval queue.",
      });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-ai-drafts"] });
    } catch (error) {
      toast({
        title: "Could not dismiss draft",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
    } finally {
      setDismissingDraftId(null);
    }
  };

  const handleCopyDraft = async (reply: string) => {
    try {
      await navigator.clipboard.writeText(reply);
      toast({ title: "Copied", description: "The suggested reply was copied." });
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
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
      toast({
        title: "WhatsApp disconnected",
        description: "The saved session was cleared. Reconnect with a QR code when you're ready.",
      });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
    } catch (error) {
      toast({
        title: "Could not disconnect WhatsApp",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const renderMessageStatus = (status: string) => {
    if (status === "failed") return <AlertCircle className="w-3 h-3" />;
    if (status === "read")
      return <CheckCheck className="w-3 h-3 text-sky-200" />;
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
        title="WhatsApp Hub"
        description="Manage messages and the AI assistant."
        className={cn(
          // On mobile, an open chat should fill the screen so the thread is not pushed down.
          mobileView === "chat" && "hidden lg:flex",
        )}
        actions={
          <>
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:text-sm",
              connected
                ? "border-primary/20 bg-primary/10 text-primary"
                : connection.status === "qrcode"
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                connected
                  ? "bg-primary animate-pulse"
                  : connection.status === "qrcode"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-muted-foreground/50",
              )}
            />
            {loadingConnection
              ? "Checking…"
              : connected
                ? "Connected"
                : connection.status === "qrcode"
                  ? "QR Ready"
                  : "Not Connected"}
          </div>
          {connected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 bg-card"
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                  <span className="sr-only">WhatsApp actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDisconnectWhatsapp}
                  disabled={disconnecting}
                >
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect WhatsApp
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </>
        }
      />

      {!loadingConnection && !connected && <WhatsappConnectionManager />}

      <div
        className={cn(
          "mt-4 flex flex-col",
          mobileView === 'chat' && selectedConversationId && "mt-0 lg:mt-4",
        )}
      >
        {aiDrafts.length > 0 && (
          <Card
            className={cn(
              "mb-4",
              mobileView === 'chat' && selectedConversationId && "hidden lg:block",
            )}
          >
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Pending AI replies</CardTitle>
                  <CardDescription className="mt-1">
                    Review customer messages and approve the AI response when it looks right.
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="self-start sm:self-auto">
                  {aiDrafts.length} pending
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {aiDrafts.map((draft) => (
                <div key={draft.id} className="space-y-3 rounded-xl border border-border/45 bg-muted/20 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {draft.clientName || draft.clientPhone || "WhatsApp customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(draft.createdAt), "d MMM yyyy, HH:mm")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {draft.proposedActions.map((action, index) => (
                        <Badge key={index} variant="outline">
                          {String(action.type ?? "Action")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs uppercase text-muted-foreground">Customer</Label>
                      <p className="whitespace-pre-wrap rounded-lg border border-border/45 bg-card p-3 text-sm leading-relaxed">
                        {draft.inboundMessageText}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase text-muted-foreground">AI reply</Label>
                      <p className="whitespace-pre-wrap rounded-lg border border-border/45 bg-card p-3 text-sm leading-relaxed">
                        {draft.suggestedReply}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => handleCopyDraft(draft.suggestedReply)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => handleDismissDraft(draft.id)} disabled={Boolean(dismissingDraftId || approvingDraftId)}>
                      {dismissingDraftId === draft.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                      Dismiss
                    </Button>
                    <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => handleApproveDraft(draft.id)} disabled={Boolean(approvingDraftId || dismissingDraftId)}>
                      {approvingDraftId === draft.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Approve & send
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <div
          className={cn(
            "grid gap-4 lg:h-[calc(100vh-12rem)] lg:min-h-[560px] lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]",
            mobileView === 'chat' && selectedConversationId
              ? "h-[calc(100dvh-2rem)] min-h-0"
              : "h-[calc(100vh-12rem)] min-h-[560px]",
          )}
        >
            <Card className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-hidden lg:max-w-[400px]",
              mobileView === 'chat' && selectedConversationId ? 'hidden lg:flex' : 'flex'
            )}>
              <div className="p-4 sm:p-5 border-b border-border/60">
                <div className="flex flex-col gap-3 sm:gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-foreground">Chats</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {connected
                          ? `${filteredConversations.length} conversations`
                          : "Connect WhatsApp to load conversations."}
                      </p>
                    </div>
                    {connected && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] sm:text-xs font-semibold">
                          {filteredConversations.length}
                        </Badge>
                      </div>
                    )}
                  </div>
                  
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                    <Input
                      placeholder="Search conversations..."
                      className="h-10 rounded-lg pl-10 pr-4 text-sm"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>

                  {connected && (
                    <div className="rounded-xl border border-border/45 bg-muted/20 p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                          <Plus className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">Start new chats</p>
                            <Badge variant="outline" className="rounded-full text-[11px] font-medium text-muted-foreground">
                              Available soon
                            </Badge>
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">
                            New outbound conversations will be enabled with the official WhatsApp Cloud API upgrade.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 cursor-not-allowed text-xs text-muted-foreground"
                            type="button"
                            disabled
                          >
                            <Clock className="mr-2 h-3.5 w-3.5" />
                            Create chat
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
                {loadingConversations ? (
                  <ConversationListSkeleton rows={6} />
                ) : filteredConversations.length > 0 ? (
                  <div className="p-2 sm:p-3 space-y-1.5 sm:space-y-2">
                    {filteredConversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => {
                          setSelectedConversationId(conv.id);
                          setMobileView('chat');
                        }}
                        className={cn(
                          "group relative flex w-full cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:gap-3 sm:p-4",
                          selectedConv?.id === conv.id
                            ? "border-primary/30 bg-primary/5"
                            : "border-border/45 bg-muted/20 hover:bg-muted/35",
                        )}
                      >
                        <Avatar className={cn(
                          "w-10 h-10 sm:w-12 sm:h-12 border-2 transition-all duration-300 shrink-0",
                          ""
                        )}>
                          <AvatarImage src={conv.avatarUrl || undefined} />
                          <AvatarFallback className={cn(
                            "font-bold text-xs sm:text-sm",
                            "bg-primary/10 text-primary"
                          )}>
                            {conv.clientName.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1 sm:mb-1.5">
                            <h4 className={cn(
                              "font-semibold truncate text-xs sm:text-sm",
                              "text-foreground"
                            )}>
                              {conv.clientName}
                            </h4>
                            <span className={cn(
                              "text-[10px] sm:text-[11px] font-medium whitespace-nowrap shrink-0",
                              "text-muted-foreground"
                            )}>
                              {format(new Date(conv.lastMessageAt), "HH:mm")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            {conv.isBot && (
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 sm:px-2 sm:py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider shrink-0",
                                "bg-primary/10 text-primary"
                              )}>
                                <Bot className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Bot
                              </span>
                            )}
                            <p
                              className={cn(
                                "truncate text-[11px] sm:text-xs leading-relaxed line-clamp-2",
                                conv.unreadCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {conv.lastMessage}
                            </p>
                          </div>
                        </div>
                        {conv.unreadCount > 0 && (
                          <Badge className={cn(
                            "rounded-full px-1.5 py-0.5 sm:px-2 sm:py-1 min-w-[20px] sm:min-w-[24px] h-5 sm:h-6 flex items-center justify-center shrink-0 text-[10px] sm:text-[11px] font-bold",
                            "bg-primary text-primary-foreground"
                          )}>
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <PageEmptyState
                    icon={MessageSquare}
                    title={connected ? "No conversations yet" : "Connect WhatsApp"}
                    description={
                      connected
                        ? "Start a conversation to see it here."
                        : "Connect your WhatsApp account to load conversations."
                    }
                    className="h-full min-h-40 sm:min-h-48"
                  />
                )}
              </div>
            </Card>

            <Card className={cn(
              "h-full min-h-0 flex-1 flex-col overflow-hidden",
              mobileView === 'list' ? 'hidden lg:flex' : 'flex'
            )}>
              {selectedConv ? (
                <>
                  <div className="p-4 sm:p-5 border-b border-border/60">
                    <div className="flex items-center justify-between gap-3 sm:gap-4">
                      <div className="flex items-center gap-1 sm:gap-3 min-w-0">
                        {/* Back to chat list — mobile only, native chat-app
                            placement: icon button directly beside the avatar,
                            not a separate labeled row above it. */}
                        <button
                          type="button"
                          onClick={() => setMobileView('list')}
                          aria-label="Back to all chats"
                          className="flex lg:hidden h-9 w-9 -ml-1 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <Avatar className="w-10 h-10 sm:w-12 sm:h-12 border">
                          <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm sm:text-base">
                            {selectedConv.clientName
                              .substring(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <h3 className="font-bold text-foreground truncate text-sm sm:text-base">
                            {selectedConv.clientName}
                          </h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate mt-0.5">
                            {selectedConv.isBot ? (
                              <>
                                <Bot className="w-3 h-3 text-primary" /> <span className="font-medium text-primary">AI Bot Active</span>
                              </>
                            ) : selectedConv.unreadCount > 0 ? (
                              <span className="font-medium text-foreground">{selectedConv.unreadCount} unread</span>
                            ) : (
                              <span className="text-muted-foreground">Read</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] sm:text-xs font-semibold">
                          {selectedConv.isBot ? "Bot Chat" : "Customer Chat"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div
                    ref={messagePaneRef}
                    className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-muted/20 p-3 custom-scrollbar sm:space-y-4 sm:p-5"
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
                          <div className="flex justify-center pb-3 sm:pb-4">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 sm:h-9 px-3 sm:px-4 text-xs rounded-full font-medium"
                              disabled={fetchingMessages}
                              onClick={loadMoreMessages}
                            >
                              {fetchingMessages ? (
                                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              ) : null}
                              Load older messages
                            </Button>
                          </div>
                        )}
                        {messages!.map((message) => {
                          const inbound = message.direction === "inbound";
                          return (
                            <div
                              key={`${message.direction}-${message.timestamp}-${message.id}`}
                              className={cn(
                                "flex gap-2 sm:gap-3",
                                inbound ? "justify-start" : "justify-end",
                              )}
                            >
                              {inbound && (
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 self-end mb-1">
                                  <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                </div>
                              )}
                              <div
                                className={cn(
                                  "max-w-full animate-in px-3 py-2.5 text-xs fade-in slide-in-from-bottom-2 duration-300 sm:max-w-[75%] sm:px-5 sm:py-3 sm:text-sm",
                                  inbound
                                    ? "bg-muted text-foreground border border-border/60 rounded-2xl rounded-bl-sm"
                                    : "bg-primary text-primary-foreground rounded-2xl rounded-br-sm",
                                )}
                              >
                                <p className="leading-relaxed">{message.content}</p>
                                <p
                                  className={cn(
                                    "text-[10px] sm:text-xs mt-1.5 sm:mt-2 flex items-center gap-1 sm:gap-1.5",
                                    inbound
                                      ? "text-muted-foreground"
                                      : "text-primary-foreground/80 justify-end",
                                  )}
                                >
                                  <span className="font-medium">
                                    {format(
                                      new Date(message.timestamp),
                                      "MMM d, HH:mm",
                                    )}
                                  </span>
                                  {!inbound &&
                                    renderMessageStatus(message.status)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <PageEmptyState
                        icon={MessageSquare}
                        title="No messages yet"
                        description="Start the conversation by sending a message."
                        className="h-full min-h-40 sm:min-h-48"
                      />
                    )}
                    {selectedChatDrafts.length > 0 && (
                      <div className="space-y-3 pt-2">
                        {selectedChatDrafts.map((draft) => (
                          <div
                            key={draft.id}
                            className="flex justify-end"
                          >
                            <div className="max-w-full space-y-2 sm:max-w-[75%]">
                              <div className="rounded-2xl rounded-br-sm bg-emerald-800 px-3 py-2.5 text-xs text-white shadow-lg sm:px-5 sm:py-3 sm:text-sm">
                                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-100">
                                  <Bot className="h-3.5 w-3.5" />
                                  Pending AI reply
                                </div>
                                <p className="whitespace-pre-wrap leading-relaxed">
                                  {draft.suggestedReply}
                                </p>
                                <p className="mt-2 flex items-center justify-end gap-1 text-[10px] font-medium text-emerald-100 sm:text-xs">
                                  {format(new Date(draft.createdAt), "MMM d, HH:mm")}
                                  <Clock className="h-3 w-3" />
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-full bg-card sm:w-auto"
                                  onClick={() => handleCopyDraft(draft.suggestedReply)}
                                >
                                  <Copy className="mr-2 h-3.5 w-3.5" />
                                  Copy
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-full bg-card sm:w-auto"
                                  onClick={() => handleDismissDraft(draft.id)}
                                  disabled={Boolean(dismissingDraftId || approvingDraftId)}
                                >
                                  {dismissingDraftId === draft.id ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <X className="mr-2 h-3.5 w-3.5" />
                                  )}
                                  Dismiss
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 w-full sm:w-auto"
                                  onClick={() => handleApproveDraft(draft.id)}
                                  disabled={Boolean(approvingDraftId || dismissingDraftId)}
                                >
                                  {approvingDraftId === draft.id ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="mr-2 h-3.5 w-3.5" />
                                  )}
                                  Approve & send
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3 sm:p-4 border-t border-border/60 bg-card">
                    <div className="flex gap-2 sm:gap-3 items-end">
                      <div className="flex-1">
                        <Textarea
                          placeholder={
                            connected
                              ? "Type your message..."
                              : "Connect WhatsApp to reply."
                          }
                          className="max-h-32 min-h-[44px] resize-none text-xs sm:min-h-[52px] sm:text-sm"
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
                      </div>
                      <Button
                        size="icon"
                        className="shrink-0 h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                        disabled={
                          !connected ||
                          !replyText.trim() ||
                          sendMessage.isPending
                        }
                        onClick={handleSendReply}
                      >
                        {sendMessage.isPending ? (
                          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-5 sm:p-8 border-b border-border/60 flex items-center gap-3 sm:gap-4">
                    <Avatar className="w-12 h-12 sm:w-14 sm:h-14 border">
                      <AvatarFallback className="bg-muted">
                        <UserCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-bold text-base sm:text-lg text-foreground">Select a Conversation</h3>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        Choose a chat to view messages and reply
                      </p>
                    </div>
                  </div>
                  <PageEmptyState
                    icon={MessageSquare}
                    title="Ready to chat?"
                    description="Select a conversation from the list on the left to view message history and send replies."
                    className="min-h-[350px] flex-1 sm:min-h-[400px]"
                  />
                </>
              )}
            </Card>
        </div>
      </div>
    </div>
  );
}
