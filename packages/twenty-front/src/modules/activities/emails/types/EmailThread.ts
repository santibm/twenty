import { EmailThreadMessage } from '@/activities/emails/types/EmailThreadMessage';

export type EmailThread = {
  id: string;
  subject: string;
  messages: EmailThreadMessage[];
  provider: 'GOOGLE' | 'MICROSOFT' | 'IMAP';
  imapFolder?: string;
  __typename: 'EmailThread';
};
