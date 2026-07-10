export function shouldAllowOutboundToContact(status: string | null | undefined, hasRecentInboundConversation: boolean): boolean {
  if (status === 'active') {
    return true;
  }

  return hasRecentInboundConversation;
}
