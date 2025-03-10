import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ConnectedAccountProvider } from 'twenty-shared';
import { EntityManager, Repository } from 'typeorm';
import { v4 } from 'uuid';
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { EnvironmentService } from 'src/engine/core-modules/environment/environment.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { TwentyORMGlobalManager } from 'src/engine/twenty-orm/twenty-orm-global.manager';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { AccountsToReconnectService } from 'src/modules/connected-account/services/accounts-to-reconnect.service';
import { ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import {
  MessageChannelSyncStage,
  MessageChannelSyncStatus,
  MessageChannelType,
  MessageChannelVisibility,
  MessageChannelWorkspaceEntity,
} from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

@Injectable()
export class IMAPAPIsService {
  constructor(
    private readonly twentyORMGlobalManager: TwentyORMGlobalManager,
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly environmentService: EnvironmentService,
    private readonly accountsToReconnectService: AccountsToReconnectService,
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
    @InjectRepository(ObjectMetadataEntity, 'metadata')
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
  ) {}

  async connectToIMAPServer(input: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  }) {
    const client = new ImapFlow({
      host: input.host,
      port: input.port,
      secure: input.secure,
      auth: {
        user: input.user,
        pass: input.password,
      },
    });

    await client.connect();
    return client;
  }

  async fetchEmailsFromIMAPServer(client: ImapFlow, mailbox: string) {
    await client.mailboxOpen(mailbox);
    const messages = [];

    for await (const message of client.fetch('1:*', { envelope: true, source: true })) {
      const parsed = await simpleParser(message.source);
      messages.push(parsed);
    }

    await client.logout();
    return messages;
  }

  async refreshIMAPAccount(input: {
    handle: string;
    workspaceMemberId: string;
    workspaceId: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    messageVisibility: MessageChannelVisibility | undefined;
  }) {
    const {
      handle,
      workspaceId,
      workspaceMemberId,
      messageVisibility,
    } = input;

    const connectedAccountRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<ConnectedAccountWorkspaceEntity>(
        workspaceId,
        'connectedAccount',
      );

    const connectedAccount = await connectedAccountRepository.findOne({
      where: { handle, accountOwnerId: workspaceMemberId },
    });

    const existingAccountId = connectedAccount?.id;
    const newOrExistingConnectedAccountId = existingAccountId ?? v4();

    const messageChannelRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<MessageChannelWorkspaceEntity>(
        workspaceId,
        'messageChannel',
      );

    const workspaceDataSource =
      await this.twentyORMGlobalManager.getDataSourceForWorkspace(workspaceId);

    await workspaceDataSource.transaction(async (manager: EntityManager) => {
      if (!existingAccountId) {
        const newConnectedAccount = await connectedAccountRepository.save(
          {
            id: newOrExistingConnectedAccountId,
            handle,
            provider: ConnectedAccountProvider.IMAP,
            accessToken: input.password,
            refreshToken: input.password,
            accountOwnerId: workspaceMemberId,
            scopes: [],
          },
          {},
          manager,
        );

        const connectedAccountMetadata =
          await this.objectMetadataRepository.findOneOrFail({
            where: { nameSingular: 'connectedAccount', workspaceId },
          });

        this.workspaceEventEmitter.emitDatabaseBatchEvent({
          objectMetadataNameSingular: 'connectedAccount',
          action: DatabaseEventAction.CREATED,
          events: [
            {
              recordId: newConnectedAccount.id,
              objectMetadata: connectedAccountMetadata,
              properties: {
                after: newConnectedAccount,
              },
            },
          ],
          workspaceId,
        });

        const newMessageChannel = await messageChannelRepository.save(
          {
            id: v4(),
            connectedAccountId: newOrExistingConnectedAccountId,
            type: MessageChannelType.EMAIL,
            handle,
            visibility:
              messageVisibility || MessageChannelVisibility.SHARE_EVERYTHING,
            syncStatus: MessageChannelSyncStatus.ONGOING,
          },
          {},
          manager,
        );

        const messageChannelMetadata =
          await this.objectMetadataRepository.findOneOrFail({
            where: { nameSingular: 'messageChannel', workspaceId },
          });

        this.workspaceEventEmitter.emitDatabaseBatchEvent({
          objectMetadataNameSingular: 'messageChannel',
          action: DatabaseEventAction.CREATED,
          events: [
            {
              recordId: newMessageChannel.id,
              objectMetadata: messageChannelMetadata,
              properties: {
                after: newMessageChannel,
              },
            },
          ],
          workspaceId,
        });
      } else {
        const updatedConnectedAccount = await connectedAccountRepository.update(
          {
            id: newOrExistingConnectedAccountId,
          },
          {
            accessToken: input.password,
            refreshToken: input.password,
            scopes: [],
          },
          manager,
        );

        const connectedAccountMetadata =
          await this.objectMetadataRepository.findOneOrFail({
            where: { nameSingular: 'connectedAccount', workspaceId },
          });

        this.workspaceEventEmitter.emitDatabaseBatchEvent({
          objectMetadataNameSingular: 'connectedAccount',
          action: DatabaseEventAction.UPDATED,
          events: [
            {
              recordId: newOrExistingConnectedAccountId,
              objectMetadata: connectedAccountMetadata,
              properties: {
                before: connectedAccount,
                after: {
                  ...connectedAccount,
                  ...updatedConnectedAccount.raw[0],
                },
              },
            },
          ],
          workspaceId,
        });

        const workspaceMemberRepository =
          await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkspaceMemberWorkspaceEntity>(
            workspaceId,
            'workspaceMember',
          );

        const workspaceMember = await workspaceMemberRepository.findOneOrFail({
          where: { id: workspaceMemberId },
        });

        const userId = workspaceMember.userId;

        await this.accountsToReconnectService.removeAccountToReconnect(
          userId,
          workspaceId,
          newOrExistingConnectedAccountId,
        );

        const messageChannels = await messageChannelRepository.find({
          where: { connectedAccountId: newOrExistingConnectedAccountId },
        });

        const messageChannelUpdates = await messageChannelRepository.update(
          {
            connectedAccountId: newOrExistingConnectedAccountId,
          },
          {
            syncStage: MessageChannelSyncStage.FULL_MESSAGE_LIST_FETCH_PENDING,
            syncStatus: null,
            syncCursor: '',
            syncStageStartedAt: null,
          },
          manager,
        );

        const messageChannelMetadata =
          await this.objectMetadataRepository.findOneOrFail({
            where: { nameSingular: 'messageChannel', workspaceId },
          });

        this.workspaceEventEmitter.emitDatabaseBatchEvent({
          objectMetadataNameSingular: 'messageChannel',
          action: DatabaseEventAction.UPDATED,
          events: messageChannels.map((messageChannel) => ({
            recordId: messageChannel.id,
            objectMetadata: messageChannelMetadata,
            properties: {
              before: messageChannel,
              after: { ...messageChannel, ...messageChannelUpdates.raw[0] },
            },
          })),
          workspaceId,
        });
      }
    });

    const messageChannels = await messageChannelRepository.find({
      where: {
        connectedAccountId: newOrExistingConnectedAccountId,
      },
    });

    for (const messageChannel of messageChannels) {
      const client = await this.connectToIMAPServer(input);
      const emails = await this.fetchEmailsFromIMAPServer(client, 'INBOX');
      // Process emails as needed
    }
  }
}
