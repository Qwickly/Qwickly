import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  Calendar as CalendarIcon,
  Lock,
  ArrowRight,
  UserCheck,
  Megaphone,
  Briefcase,
  Database,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { ChatPageSkeleton } from "@/components/skeletons/page-skeletons";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function AiAssistantPage() {
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hi Aiden! I'm your Qwickly AI Assistant. I can help you analyze your business data, draft marketing messages, or answer questions about your bookings. How can I help today?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [compactInput, setCompactInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setCompactInput(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Check if AI Assistant is enabled in subscription
  const aiAssistantEnabled = subscription?.metadata?.aiAssistantEnabled ||
                              subscription?.plans?.metadata?.aiAssistantEnabled || false;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

    // Skip the initial mount so the page doesn't jump on load.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    // On mobile the page scrolls (not the inner panel), so smoothly bring
    // the latest message into view when the bot replies or starts typing.
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isTyping]);

  const sendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content:
            "Based on your data from the last 30 days, your busiest times are Fridays between 2 PM and 6 PM. I recommend adding extra staff during those hours to maximize revenue. Would you like me to adjust the staff schedule for next week?",
        },
      ]);
      setIsTyping(false);
    }, 1500);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    sendMessage(input);
  };

  const prompts = [
    { icon: TrendingUp, text: "Analyze my revenue for the last month" },
    { icon: Users, text: "Which clients haven't visited in 90 days?" },
    { icon: CalendarIcon, text: "Summarize tomorrow's schedule" },
    { icon: Sparkles, text: "Draft a promotional SMS for a slow Tuesday" },
  ];

  const capabilities = [
    { icon: CalendarIcon, label: "Bookings" },
    { icon: TrendingUp, label: "Revenue insights" },
    { icon: Users, label: "Client retention" },
    { icon: UserCheck, label: "Staff planning" },
    { icon: Megaphone, label: "Marketing drafts" },
  ];

  const connectedData = [
    { icon: CalendarIcon, label: "Bookings" },
    { icon: Users, label: "Clients" },
    { icon: Briefcase, label: "Services" },
    { icon: UserCheck, label: "Staff" },
  ];

  const unlockBenefits = [
    "Revenue analysis",
    "Client retention",
    "Schedule summaries",
    "Marketing drafts",
  ];

  // Show lock screen if AI Assistant is not enabled
  if (loadingSubscription) {
    return <ChatPageSkeleton />;
  }

  if (!aiAssistantEnabled) {
    return (
      <div className="flex items-center justify-center px-4 py-10 lg:min-h-[calc(100dvh-4rem)] lg:py-0">
        <Card className="relative w-full max-w-lg overflow-hidden border-transparent shadow-[0_18px_45px_rgba(15,118,110,0.12),0_2px_10px_rgba(15,23,42,0.06)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/10 to-transparent" />
          <CardContent className="relative p-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <Badge
              variant="outline"
              className="mb-3 rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
            >
              <Lock className="mr-1 h-3 w-3" /> Premium feature
            </Badge>
            <h2 className="text-2xl font-bold text-foreground">Unlock the AI Assistant</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Upgrade your plan to get an AI workspace connected to your business data — revenue analysis,
              retention, schedules, and marketing on demand.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
              {unlockBenefits.map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">{benefit}</span>
                </div>
              ))}
            </div>
            <Button className="mt-6 w-full" asChild>
              <a href="/billing" className="!text-white hover:!text-white">
                Upgrade Plan <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            AI Assistant
          </h1>
          <Badge
            variant="outline"
            className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
          >
            <Sparkles className="mr-1 h-3 w-3" /> AI powered
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Ask Qwickly about bookings, revenue, clients, staff, and marketing.
        </p>
      </div>

      <div className="grid gap-6 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Chat panel */}
        <Card className="flex min-h-[70dvh] flex-col overflow-hidden border-border/50 shadow-sm lg:h-full lg:min-h-0">
          <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card px-4 py-3">
            <Avatar className="h-10 w-10 border border-primary/20 bg-card shadow-sm">
              <AvatarImage src="/qwickly-icon.svg" alt="Qwickly" className="object-contain p-1.5" />
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">Q</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">Qwickly Assistant</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected to your business data
              </p>
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto bg-gradient-to-b from-muted/40 to-background p-4 sm:p-6"
            ref={scrollRef}
          >
            <div className="max-w-3xl mx-auto space-y-4 pb-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-end gap-3",
                    message.role === "user" ? "flex-row-reverse" : "flex-row",
                  )}
                >
                  <Avatar
                    className={cn(
                      "h-9 w-9 shrink-0 border bg-card shadow-sm",
                      message.role === "assistant"
                        ? "border-primary/20"
                        : "border-border/60",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <>
                        <AvatarImage src="/qwickly-icon.svg" alt="Qwickly" className="object-contain p-1.5" />
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">Q</AvatarFallback>
                      </>
                    ) : (
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    )}
                  </Avatar>

                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-4 py-3 shadow-sm",
                      message.role === "user"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md border border-border/60 bg-card text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex items-end gap-3">
                  <Avatar className="h-9 w-9 shrink-0 border border-primary/20 bg-card shadow-sm">
                    <AvatarImage src="/qwickly-icon.svg" alt="Qwickly" className="object-contain p-1.5" />
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">Q</AvatarFallback>
                  </Avatar>
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border/60 bg-card px-4 py-3 shadow-sm">
                    <div
                      className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              )}

              {messages.length === 1 && (
                <div className="mt-8 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">Try asking</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {prompts.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(prompt.text)}
                        className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left text-sm transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm"
                      >
                        <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0 transition-colors group-hover:bg-primary/15">
                          <prompt.icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm leading-relaxed text-foreground">
                          {prompt.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/60 bg-card p-4">
            <form
              onSubmit={handleSubmit}
              className="max-w-3xl mx-auto relative flex items-center"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={compactInput ? "Ask Qwickly…" : "Ask about your revenue, clients, or schedules..."}
                className="rounded-full bg-muted/50 py-6 pr-12 text-base"
              />
              <Button
                type="submit"
                size="icon"
                className="absolute right-1.5 h-10 w-10 rounded-full"
                disabled={!input.trim() || isTyping}
              >
                <Send className="w-4 h-4 ml-0.5" />
              </Button>
            </form>
            <div className="text-center mt-2">
              <span className="text-xs text-muted-foreground">
                Qwickly AI can make mistakes. Check important business data.
              </span>
            </div>
          </div>
          <div ref={bottomRef} />
        </Card>

        {/* Assistant sidebar */}
        <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto lg:flex">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Quick actions</h3>
              </div>
              <div className="space-y-2">
                {prompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(prompt.text)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card p-2.5 text-left text-xs font-medium text-foreground transition-all hover:border-primary/50 hover:bg-primary/5"
                  >
                    <prompt.icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="line-clamp-2">{prompt.text}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Can help with</h3>
              <div className="space-y-1">
                {capabilities.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <span className="font-medium text-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Connected data</h3>
              </div>
              <div className="space-y-1.5">
                {connectedData.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      {item.label}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Synced
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
