import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export async function fetchIMAPEmailThread(client: ImapFlow, mailbox: string) {
  await client.mailboxOpen(mailbox);
  const messages = [];

  for await (const message of client.fetch('1:*', { envelope: true, source: true })) {
    const parsed = await simpleParser(message.source);
    messages.push(parsed);
  }

  await client.logout();
  return messages;
}
