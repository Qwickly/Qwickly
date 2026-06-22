import { Search, Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";

export function TopNav() {
  const { connected: whatsappConnected } = useWhatsappConnection();

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center flex-1 max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search bookings, clients, or staff..." 
            className="w-full pl-9 bg-muted/50 border-none focus-visible:ring-1 focus-visible:bg-background"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {whatsappConnected && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            WhatsApp Connected
          </div>
        )}
        
        <Badge variant="outline" className="hidden sm:inline-flex bg-background font-medium">
          Pro Plan
        </Badge>
        
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-background" />
        </Button>
        
        <div className="h-8 w-px bg-border mx-1" />
        
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-none text-foreground">Aiden T.</p>
            <p className="text-xs text-muted-foreground mt-0.5">Admin</p>
          </div>
          <Avatar className="w-9 h-9 border border-border cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarImage src="https://i.pravatar.cc/150?u=aiden" />
            <AvatarFallback className="bg-primary/10 text-primary">AT</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
