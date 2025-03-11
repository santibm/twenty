import { Test, TestingModule } from '@nestjs/testing';
import { IMAPAPIsService } from './imap-apis.service';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

describe('IMAPAPIsService', () => {
  let service: IMAPAPIsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IMAPAPIsService],
    }).compile();

    service = module.get<IMAPAPIsService>(IMAPAPIsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should establish IMAP connection correctly', async () => {
    const mockClient = {
      connect: jest.fn(),
      logout: jest.fn(),
      mailboxOpen: jest.fn(),
      fetch: jest.fn().mockReturnValue([]),
    };

    jest.spyOn(ImapFlow.prototype, 'connect').mockImplementation(mockClient.connect);
    jest.spyOn(ImapFlow.prototype, 'logout').mockImplementation(mockClient.logout);
    jest.spyOn(ImapFlow.prototype, 'mailboxOpen').mockImplementation(mockClient.mailboxOpen);
    jest.spyOn(ImapFlow.prototype, 'fetch').mockImplementation(mockClient.fetch);

    const client = await service.connectToIMAPServer({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'test@example.com',
      password: 'password',
    });

    expect(client).toBeDefined();
    expect(mockClient.connect).toHaveBeenCalled();
  });

  it('should fetch emails correctly from IMAP server', async () => {
    const mockClient = {
      connect: jest.fn(),
      logout: jest.fn(),
      mailboxOpen: jest.fn(),
      fetch: jest.fn().mockReturnValue([
        { source: 'email source 1' },
        { source: 'email source 2' },
      ]),
    };

    jest.spyOn(ImapFlow.prototype, 'connect').mockImplementation(mockClient.connect);
    jest.spyOn(ImapFlow.prototype, 'logout').mockImplementation(mockClient.logout);
    jest.spyOn(ImapFlow.prototype, 'mailboxOpen').mockImplementation(mockClient.mailboxOpen);
    jest.spyOn(ImapFlow.prototype, 'fetch').mockImplementation(mockClient.fetch);
    jest.spyOn(simpleParser, 'parse').mockImplementation((source) => ({ text: source }));

    const client = await service.connectToIMAPServer({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'test@example.com',
      password: 'password',
    });

    const emails = await service.fetchEmailsFromIMAPServer(client, 'INBOX');

    expect(emails).toHaveLength(2);
    expect(emails[0].text).toBe('email source 1');
    expect(emails[1].text).toBe('email source 2');
  });
});
