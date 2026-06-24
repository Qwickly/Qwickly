import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getGetWhatsappConversationsQueryKey,
  type WhatsappConversation,
  type WhatsappMessage,
  useGetWhatsappConversations,
  useMarkWhatsappConversationRead,
  useSendWhatsappConversationMessage,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, Bot, Settings2, Search, UserCircle2, Send, Plus, Clock, Check, CheckCheck, AlertCircle, Scissors } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WhatsappConnectionManager } from "@/components/settings/WhatsappConnectionManager";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { getCachedConversations, setCachedConversations, getCachedMessages, setCachedMessages } from "@/lib/whatsapp-cache";
import { catalogKeys, fetchServices } from "@/lib/catalog";
import { fetchBotSettings, saveBotSettings, type BotTone, type BotSettings, type BotWorkingHour } from "@/lib/bot-settings";


const ALL_DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
] as const;

type DayKey = (typeof ALL_DAYS)[number]["key"];

type DayHour = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

const DEFAULT_HOURS: Record<DayKey, DayHour> = {
  monday:    { isOpen: true,  openTime: "08:00", closeTime: "18:00" },
  tuesday:   { isOpen: true,  openTime: "08:00", closeTime: "18:00" },
  wednesday: { isOpen: true,  openTime: "08:00", closeTime: "18:00" },
  thursday:  { isOpen: true,  openTime: "08:00", closeTime: "18:00" },
  friday:    { isOpen: true,  openTime: "08:00", closeTime: "18:00" },
  saturday:  { isOpen: true,  openTime: "08:00", closeTime: "15:00" },
  sunday:    { isOpen: false, openTime: "09:00", closeTime: "13:00" },
};

const MESSAGE_BATCH_SIZE = 25;
const MAX_MESSAGE_LIMIT = 500;

async function fetchWhatsappMessages(conversationId: number, limit: number): Promise<WhatsappMessage[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const response = await fetch(`/api/whatsapp/conversations/${conversationId}/messages?limit=${limit}`, {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Could not load WhatsApp messages");
  }

  return response.json() as Promise<WhatsappMessage[]>;
}

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
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
  const { connection, connected, loading: loadingConnection } = useWhatsappConnection();

  // Bot setup state
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [workingHours, setWorkingHours] = useState<Record<DayKey, DayHour>>(DEFAULT_HOURS);
  const [allowedServiceIds, setAllowedServiceIds] = useState<Set<string>>(new Set());
  const [servicesInitialised, setServicesInitialised] = useState(false);

  // Supabase Bot Settings state
  const [businessId, setBusinessId] = useState<string>("");
  const [loadingBotSettings, setLoadingBotSettings] = useState(false);
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [acceptCancellations, setAcceptCancellations] = useState(true);
  const [sendPaymentLinks, setSendPaymentLinks] = useState(true);
  const [answerFaqs, setAnswerFaqs] = useState(true);
  const [tone, setTone] = useState<BotTone>("friendly");
  const [botName, setBotName] = useState("Bookza Assistant");
  const [welcomeMessage, setWelcomeMessage] = useState("Hi! 👋 How can I help you today?");
  const [fallbackMessage, setFallbackMessage] = useState("I'll pass you to a human who can help. Please hold! 🙏");


  const updateHour = (day: DayKey, patch: Partial<DayHour>) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  };

  // Fetch real services
  const { data: allServices, isLoading: loadingServices } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const activeServices = useMemo(() => (allServices ?? []).filter((s) => s.isActive), [allServices]);

  // When services first load, default all to allowed
  useEffect(() => {
    if (!servicesInitialised && activeServices.length > 0) {
      setAllowedServiceIds(new Set(activeServices.map((s) => s.id)));
      setServicesInitialised(true);
    }
  }, [activeServices, servicesInitialised]);

  const toggleService = (id: string) => {
    setAllowedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Fetch Bot Settings on Mount
  useEffect(() => {
    async function loadSettings() {
      try {
        setLoadingBotSettings(true);
        const data = await fetchBotSettings();
        setBusinessId(data.settings.business_id);
        setBotEnabled(data.settings.bot_enabled);
        setAutoConfirm(data.settings.auto_confirm);
        setAcceptCancellations(data.settings.accept_cancellations);
        setSendPaymentLinks(data.settings.send_payment_links);
        setAnswerFaqs(data.settings.answer_faqs);
        setAlwaysOn(data.settings.always_on);
        setTone(data.settings.tone);
        setBotName(data.settings.bot_name);
        setWelcomeMessage(data.settings.welcome_message);
        setFallbackMessage(data.settings.fallback_message);

        // Populate working hours map
        const hoursMap = { ...DEFAULT_HOURS };
        data.workingHours.forEach((wh) => {
          const key = wh.day_name as DayKey;
          if (hoursMap[key]) {
            hoursMap[key] = {
              isOpen: wh.is_open,
              openTime: wh.open_time,
              closeTime: wh.close_time,
            };
          }
        });
        setWorkingHours(hoursMap);

        // Populate allowed services
        setAllowedServiceIds(new Set(data.allowedServiceIds));
        setServicesInitialised(true);
      } catch (err) {
        toast({
          title: "Failed to load bot settings",
          description: err instanceof Error ? err.message : "Error connecting to database",
          variant: "destructive",
        });
      } finally {
        setLoadingBotSettings(false);
      }
    }
    void loadSettings();
  }, [toast]);

  // Save Bot Settings to Supabase
  const handleSaveBotSettings = async () => {
    try {
      setSavingBotSettings(true);

      const settings: BotSettings = {
        business_id: businessId,
        bot_enabled: botEnabled,
        auto_confirm: autoConfirm,
        accept_cancellations: acceptCancellations,
        send_payment_links: sendPaymentLinks,
        answer_faqs: answerFaqs,
        always_on: alwaysOn,
        tone: tone,
        bot_name: botName,
        welcome_message: welcomeMessage,
        fallback_message: fallbackMessage,
      };

      const hoursList: BotWorkingHour[] = ALL_DAYS.map((day) => ({
        business_id: businessId,
        day_name: day.key,
        is_open: workingHours[day.key].isOpen,
        open_time: workingHours[day.key].openTime,
        close_time: workingHours[day.key].closeTime,
      }));

      const allActiveServiceIds = activeServices.map((s) => s.id);

      await saveBotSettings(settings, hoursList, Array.from(allowedServiceIds), allActiveServiceIds);

      toast({
        title: "Bot settings saved",
        description: "Your AI bot configuration has been successfully updated in Supabase.",
      });
    } catch (err) {
      toast({
        title: "Failed to save bot settings",
        description: err instanceof Error ? err.message : "Error connecting to database",
        variant: "destructive",
      });
    } finally {
      setSavingBotSettings(false);
    }
  };

  const { data: conversations, isLoading: loadingConversations } = useGetWhatsappConversations({
    query: { 
      queryKey: getGetWhatsappConversationsQueryKey(), 
      refetchInterval: connected ? 10_000 : false,
      initialData: getCachedConversations<WhatsappConversation[]>(),
    },
  });

  useEffect(() => {
    if (conversations) {
      setCachedConversations(conversations);
    }
  }, [conversations]);
  const selectedConv = conversations?.find((conv) => conv.id === selectedConversationId) ?? null;
  const { data: messages, isLoading: loadingMessages, isFetching: fetchingMessages } = useQuery({
    queryKey: ["whatsapp-messages", selectedConv?.id, messageLimit],
    queryFn: () => fetchWhatsappMessages(selectedConv!.id, messageLimit),
    enabled: Boolean(selectedConv),
    refetchInterval: selectedConv && connected ? 7_500 : false,
    initialData: selectedConv ? getCachedMessages<WhatsappMessage[]>(selectedConv.id) : undefined,
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
  const canLoadMoreMessages = Boolean(messages && messages.length >= messageLimit && messageLimit < MAX_MESSAGE_LIMIT);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations ?? [];

    return (conversations ?? []).filter((conv) =>
      [conv.clientName, conv.clientPhone, conv.lastMessage]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  useEffect(() => {
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
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
  }, [messages, selectedConversationId]);

  useEffect(() => {
    if (!selectedConv || selectedConv.unreadCount <= 0 || markingRead) {
      return;
    }

    markReadMutate(
      { id: selectedConv.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetWhatsappConversationsQueryKey() });
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
          void queryClient.invalidateQueries({ queryKey: getGetWhatsappConversationsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", selectedConv.id] });
        },
        onError: (error) => {
          toast({
            title: "Could not send message",
            description: error instanceof Error ? error.message : "Please check the WhatsApp connection and try again.",
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
      const response = await fetch(`/api/whatsapp/contacts/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ phone, message }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Failed to send WhatsApp message.");

      setNewChatPhone("");
      setNewChatMessage("");
      setShowNewChatForm(false);
      toast({
        title: "Message sent",
        description: "Your message was delivered or queued for delivery.",
      });
      void queryClient.invalidateQueries({ queryKey: getGetWhatsappConversationsQueryKey() });
      if (payload?.conversationId) {
        setSelectedConversationId(payload.conversationId);
      }
    } catch (error) {
      toast({
        title: "Could not send message",
        description: error instanceof Error ? error.message : "Please check the WhatsApp connection and try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingNewChat(false);
    }
  };



  const renderMessageStatus = (status: string) => {
    if (status === "failed") return <AlertCircle className="w-3 h-3" />;
    if (status === "read") return <CheckCheck className="w-3 h-3 text-sky-200" />;
    if (status === "delivered") return <CheckCheck className="w-3 h-3" />;
    return <Check className="w-3 h-3" />;
  };

  const loadMoreMessages = () => {
    if (!canLoadMoreMessages || fetchingMessages) return;

    const pane = messagePaneRef.current;
    previousScrollHeightRef.current = pane?.scrollHeight ?? 0;
    loadingOlderRef.current = true;
    setMessageLimit((current) => Math.min(current + MESSAGE_BATCH_SIZE, MAX_MESSAGE_LIMIT));
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">WhatsApp Hub</h1>
          <p className="text-muted-foreground text-sm">Manage messages and the AI assistant.</p>
        </div>
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
          connected
            ? "bg-emerald-50 border-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-400"
            : connection.status === "qrcode"
              ? "bg-amber-50 border-amber-100 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-400"
              : "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-950/30 dark:border-slate-800 dark:text-slate-300"
        )}>
          <div className={cn(
            "w-2 h-2 rounded-full",
            connected
              ? "bg-emerald-500 animate-pulse"
              : connection.status === "qrcode"
                ? "bg-amber-500 animate-pulse"
                : "bg-slate-400"
          )} />
          {loadingConnection
            ? "Checking connection..."
            : connected
              ? "WhatsApp Connected"
              : connection.status === "qrcode"
                ? "QR Code Ready"
                : "WhatsApp Not Connected"}
        </div>
      </div>

      {!loadingConnection && !connected && <WhatsappConnectionManager />}
      {/*

          { label: "AI Success Rate", value: `${stats?.successRate ?? "—"}%`, icon: CheckCircle2, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" },
      */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card w-full sm:w-auto self-start shadow-sm border border-border/50">
          <TabsTrigger value="conversations" className="gap-2">
            <MessageSquare className="w-4 h-4" /> Conversations
          </TabsTrigger>
          <TabsTrigger value="bot" className="gap-2">
            <Bot className="w-4 h-4" /> AI Bot Setup
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 flex-1 min-h-0">
          {/* Conversations */}
          <TabsContent value="conversations" className="m-0 h-[580px] flex gap-4">
            <Card className="w-full sm:w-80 flex flex-col border-border/50 shadow-sm overflow-hidden h-full">
              <div className="p-4 border-b bg-card">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search chats…"
                    className="pl-9 bg-background"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {connected
                    ? "Showing live WhatsApp conversations for this connected account. Broadcast status updates are hidden."
                    : "Connect WhatsApp to load conversations for this account."}
                </p>
                {connected && (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button size="xs" variant="secondary" type="button" onClick={() => setShowNewChatForm((current) => !current)}>
                      {showNewChatForm ? "Hide new chat" : "Start new chat"}
                    </Button>
                    {showNewChatForm ? (
                      <div className="space-y-3 rounded-lg border border-border/70 bg-background p-3">
                        <div>
                          <Label htmlFor="new-chat-phone" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Phone number
                          </Label>
                          <Input
                            id="new-chat-phone"
                            placeholder="+2783 123 4567"
                            value={newChatPhone}
                            onChange={(event) => setNewChatPhone(event.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="new-chat-message" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Message
                          </Label>
                          <Textarea
                            id="new-chat-message"
                            placeholder="Type your message here..."
                            value={newChatMessage}
                            onChange={(event) => setNewChatMessage(event.target.value)}
                            className="min-h-[96px]"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={!newChatPhone.trim() || !newChatMessage.trim() || creatingNewChat}
                          onClick={handleCreateNewChat}
                        >
                          {creatingNewChat ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send new chat"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto bg-card">
                {loadingConversations ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : filteredConversations.length > 0 ? (
                  filteredConversations.map(conv => (
                    <div
                      key={conv.id}
                      onClick={() => setSelectedConversationId(conv.id)}
                      className={cn(
                        "flex items-center gap-3 p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors",
                        selectedConv?.id === conv.id && "bg-primary/5 border-l-2 border-l-primary"
                      )}
                    >
                      <Avatar className="w-10 h-10 border border-border">
                        <AvatarImage src={conv.avatarUrl || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary font-medium">{conv.clientName.substring(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <h4 className="font-semibold text-sm truncate">{conv.clientName}</h4>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(conv.lastMessageAt), "HH:mm")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {conv.isBot && <Bot className="w-3 h-3 text-primary shrink-0" />}
                          <p className={cn("text-xs truncate", conv.unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>{conv.lastMessage}</p>
                        </div>
                      </div>
                      {conv.unreadCount > 0 && (
                        <Badge className="bg-primary hover:bg-primary rounded-full px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center shrink-0">
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex h-full min-h-32 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {connected
                      ? "No received WhatsApp conversations were found for this account yet."
                      : "Connect WhatsApp to start seeing conversations here."}
                  </div>
                )}
              </div>
            </Card>

            <Card className="hidden sm:flex flex-1 flex-col border-border/50 shadow-sm overflow-hidden h-full bg-card/50">
              {selectedConv ? (
                <>
                  <div className="p-4 border-b bg-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 border border-border">
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold">{selectedConv.clientName.substring(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold">{selectedConv.clientName}</h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {selectedConv.isBot ? <><Bot className="w-3 h-3" /> AI bot active</> : selectedConv.unreadCount > 0 ? `${selectedConv.unreadCount} unread` : "Read"}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline">View Client</Button>
                  </div>

                  <div
                    ref={messagePaneRef}
                    className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20"
                    onScroll={(event) => {
                      if (event.currentTarget.scrollTop <= 8) {
                        loadMoreMessages();
                      }
                    }}
                  >
                    {loadingMessages ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : (messages?.length ?? 0) > 0 ? (
                      <>
                        {canLoadMoreMessages && (
                          <div className="flex justify-center pb-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              disabled={fetchingMessages}
                              onClick={loadMoreMessages}
                            >
                              {fetchingMessages ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
                              Load more
                            </Button>
                          </div>
                        )}
                        {messages!.map((message) => {
                          const inbound = message.direction === "inbound";
                          return (
                            <div
                              key={`${message.direction}-${message.timestamp}-${message.id}`}
                              className={cn("flex", inbound ? "justify-start" : "justify-end")}
                            >
                              {inbound && (
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mr-2 shrink-0 self-end">
                                  <MessageSquare className="w-4 h-4 text-primary" />
                                </div>
                              )}
                              <div className={cn(
                                "max-w-[70%] px-3 py-2 rounded-xl text-sm",
                                inbound ? "bg-card border border-border/50 rounded-bl-sm" : "bg-primary text-primary-foreground rounded-br-sm"
                              )}>
                                <p>{message.content}</p>
                                <p className={cn("text-xs mt-1 flex items-center gap-1", inbound ? "text-muted-foreground" : "text-primary-foreground/70 justify-end")}>
                                  <span>{format(new Date(message.timestamp), "MMM d, HH:mm")}</span>
                                  {!inbound && renderMessageStatus(message.status)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="flex h-full min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                        No messages were found in this conversation yet.
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-t bg-card">
                    <div className="flex items-end gap-2">
                      <Textarea
                        placeholder={connected ? "Reply to this conversation..." : "Connect WhatsApp before replying."}
                        className="bg-background min-h-[44px] max-h-32 resize-none"
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
                        className="shrink-0 h-11 w-11"
                        disabled={!connected || !replyText.trim() || sendMessage.isPending}
                        onClick={handleSendReply}
                      >
                        {sendMessage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-4 border-b bg-card flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                      <AvatarFallback className="bg-muted"><UserCircle2 className="w-6 h-6 text-muted-foreground" /></AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold">Select a conversation</h3>
                      <p className="text-xs text-muted-foreground">View message history and reply</p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                    <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm">Select a conversation from the sidebar to view the chat history or send a message.</p>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* Bot Setup */}
          <TabsContent value="bot" className="m-0 space-y-6">
            {loadingBotSettings ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">Loading bot settings...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-lg"><Bot className="w-5 h-5 text-primary" /></div>
                          <div>
                            <CardTitle>AI Bot Status</CardTitle>
                            <CardDescription>Configure the bot's core behaviour.</CardDescription>
                          </div>
                        </div>
                        <Badge className={cn(
                          "border",
                          botEnabled 
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200" 
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        )}>
                          {botEnabled ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {[
                        { label: "Enable AI booking bot", desc: "Bot handles new booking requests 24/7.", checked: botEnabled, onChange: setBotEnabled },
                        { label: "Auto-confirm bookings", desc: "Confirms bookings without manual approval.", checked: autoConfirm, onChange: setAutoConfirm },
                        { label: "Accept cancellations via chat", desc: "Bot processes cancellation requests.", checked: acceptCancellations, onChange: setAcceptCancellations },
                        { label: "Send payment links", desc: "Bot sends deposit links automatically.", checked: sendPaymentLinks, onChange: setSendPaymentLinks },
                        { label: "Answer FAQs", desc: "Bot responds to common client questions.", checked: answerFaqs, onChange: setAnswerFaqs },
                      ].map(item => (
                        <div key={item.label} className="flex items-center justify-between gap-4">
                          <div>
                            <Label className="font-medium text-sm">{item.label}</Label>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                          <Switch checked={item.checked} onCheckedChange={item.onChange} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>Working Hours</CardTitle>
                      <CardDescription>Outside these hours, the bot will reply that you're unavailable.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                        <div>
                          <Label className="font-medium">24/7 mode (always on)</Label>
                          <p className="text-xs text-muted-foreground">Bot replies around the clock regardless of hours.</p>
                        </div>
                        <Switch checked={alwaysOn} onCheckedChange={setAlwaysOn} />
                      </div>
                      <div className="space-y-2">
                        {ALL_DAYS.map((day) => {
                          const hour = workingHours[day.key];
                          return (
                            <div key={day.key} className={cn("flex items-center gap-3 py-2 border-b last:border-0", alwaysOn && "opacity-50 pointer-events-none")}>
                              <Switch
                                  checked={hour.isOpen}
                                  onCheckedChange={(v) => updateHour(day.key, { isOpen: v })}
                              />
                              <Label className="w-24 shrink-0 font-medium">{day.label}</Label>
                              {hour.isOpen ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <Input
                                    type="time"
                                    value={hour.openTime}
                                    onChange={(e) => updateHour(day.key, { openTime: e.target.value })}
                                    className="w-28 bg-muted/50"
                                  />
                                  <span className="text-muted-foreground text-sm">–</span>
                                  <Input
                                    type="time"
                                    value={hour.closeTime}
                                    onChange={(e) => updateHour(day.key, { closeTime: e.target.value })}
                                    className="w-28 bg-muted/50"
                                  />
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground italic">Closed</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>



                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>Bot Personality</CardTitle>
                      <CardDescription>Customise how the AI communicates with your clients.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Tone of voice</Label>
                        <Select value={tone} onValueChange={(v) => setTone(v as BotTone)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="friendly">Friendly & Warm</SelectItem>
                            <SelectItem value="professional">Professional & Formal</SelectItem>
                            <SelectItem value="casual">Casual & Fun</SelectItem>
                            <SelectItem value="concise">Brief & Concise</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Bot name shown to clients</Label>
                        <Input value={botName} onChange={(e) => setBotName(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Welcome message</Label>
                        <Input value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Fallback (human handoff) message</Label>
                        <Input value={fallbackMessage} onChange={(e) => setFallbackMessage(e.target.value)} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>Allowed Services</CardTitle>
                      <CardDescription>The bot can only book these services automatically.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {loadingServices ? (
                        <div className="flex items-center justify-center h-24">
                          <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                      ) : activeServices.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
                          <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                            <Scissors className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">No services found</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Add services on the Services page first.</p>
                          </div>
                        </div>
                      ) : (
                        activeServices.map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg hover:border-primary/30 transition-colors">
                            <div>
                              <Label className="font-medium text-sm cursor-pointer">{s.name}</Label>
                              {s.duration ? (
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <Clock className="w-3 h-3" />
                                  {s.duration} min · R {s.price.toLocaleString()}
                                </p>
                              ) : null}
                            </div>
                            <Switch
                              checked={allowedServiceIds.has(s.id)}
                              onCheckedChange={() => toggleService(s.id)}
                            />
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="flex justify-end">
                  <Button 
                    className="bg-primary hover:bg-primary/90" 
                    onClick={handleSaveBotSettings}
                    disabled={savingBotSettings}
                  >
                    {savingBotSettings ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Bot Settings"
                    )}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
