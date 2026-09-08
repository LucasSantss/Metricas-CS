export function conversationUrl(chatbotId: string, userId: string): string {
  return `https://portal.chatbotmaker.io/#/chatbot/${chatbotId}/messaging/${userId}`;
}
