import { useRecoilCallback } from 'recoil';

import { useOpenEmailThreadRightDrawer } from '@/activities/emails/right-drawer/hooks/useOpenEmailThreadRightDrawer';
import { viewableRecordIdState } from '@/object-record/record-right-drawer/states/viewableRecordIdState';
import { useRightDrawer } from '@/ui/layout/right-drawer/hooks/useRightDrawer';
import { isRightDrawerOpenState } from '@/ui/layout/right-drawer/states/isRightDrawerOpenState';
import { ConnectedAccountProvider } from '@/modules/accounts/types/MessageChannel';
import { fetchIMAPEmailThread } from '@/modules/activities/emails/utils/fetchIMAPEmailThread';

export const useEmailThread = () => {
  const { closeRightDrawer } = useRightDrawer();
  const openEmailThreadRightDrawer = useOpenEmailThreadRightDrawer();

  const openEmailThread = useRecoilCallback(
    ({ snapshot, set }) =>
      async (threadId: string, provider: ConnectedAccountProvider) => {
        const isRightDrawerOpen = snapshot
          .getLoadable(isRightDrawerOpenState)
          .getValue();

        const viewableEmailThreadId = snapshot
          .getLoadable(viewableRecordIdState)
          .getValue();

        if (isRightDrawerOpen && viewableEmailThreadId === threadId) {
          set(viewableRecordIdState, null);
          closeRightDrawer();
          return;
        }

        if (provider === ConnectedAccountProvider.IMAP) {
          const emailThread = await fetchIMAPEmailThread(threadId);
          if (emailThread) {
            openEmailThreadRightDrawer();
            set(viewableRecordIdState, emailThread.id);
          }
        } else {
          openEmailThreadRightDrawer();
          set(viewableRecordIdState, threadId);
        }
      },
    [closeRightDrawer, openEmailThreadRightDrawer],
  );

  return { openEmailThread };
};
