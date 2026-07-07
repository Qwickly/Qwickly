import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  User,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  Calendar as CalendarIcon,
  Loader2,
  Lock,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchSubscription } from "@/lib/catalog-subscriptions";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check if AI Assistant is enabled in subscription
  const aiAssistantEnabled = subscription?.metadata?.aiAssistantEnabled || 
                              subscription?.plans?.metadata?.aiAssistantEnabled || false;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      content: input,
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

  const prompts = [
    { icon: TrendingUp, text: "Analyze my revenue for the last month" },
    { icon: Users, text: "Which clients haven't visited in 90 days?" },
    { icon: CalendarIcon, text: "Summarize tomorrow's schedule" },
    { icon: Sparkles, text: "Draft a promotional SMS for a slow Tuesday" },
  ];

  // Show lock screen if AI Assistant is not enabled
  if (loadingSubscription) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!aiAssistantEnabled) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Card className="max-w-md p-8 text-center border-border/50">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">AI Assistant Locked</h2>
          <p className="text-muted-foreground mb-6">
            The AI Assistant feature is not included in your current plan. Upgrade to access intelligent business insights and automated analysis.
          </p>
          <Button className="w-full" asChild>
            <a href="/billing">
              Upgrade Plan <ArrowRight className="w-4 h-4 ml-2" />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col gap-1 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          AI Assistant
        </h1>
        <p className="text-muted-foreground text-sm">
          Chat with your intelligent business assistant.
        </p>
      </div>

      <Card className="flex-1 shadow-sm border-border/50 flex flex-col overflow-hidden bg-card">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6" ref={scrollRef}>
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-4",
                  message.role === "user" ? "flex-row-reverse" : "flex-row",
                )}
              >
                <Avatar
                  className={cn(
                    "w-8 h-8 border",
                    message.role === "assistant"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted",
                  )}
                >
                  {message.role === "assistant" ? (
                    <Bot className="w-5 h-5" />
                  ) : (
                    <AvatarFallback className="text-xs">AT</AvatarFallback>
                  )}
                </Avatar>

                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl max-w-[80%]",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted/50 border border-border/50 rounded-tl-sm text-foreground",
                  )}
                >
                  <p className="text-sm leading-relaxed">{message.content}</p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex gap-4">
                <Avatar className="w-8 h-8 border bg-primary text-primary-foreground border-primary">
                  <Bot className="w-5 h-5" />
                </Avatar>
                <div className="px-4 py-3 rounded-2xl bg-muted/50 border border-border/50 rounded-tl-sm flex items-center gap-1">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                {prompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(prompt.text);
                      handleSubmit();
                    }}
                    className="flex items-center gap-3 p-3 border rounded-xl bg-card hover:bg-muted/50 hover:border-primary/50 text-left transition-colors text-sm"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <prompt.icon className="w-4 h-4" />
                    </div>
                    <span className="text-muted-foreground font-medium">
                      {prompt.text}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t bg-card shrink-0">
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto relative flex items-center"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your revenue, clients, or schedules..."
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
      </Card>
    </div>
  );
}
