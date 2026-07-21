import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { createTarget, findTargetByName } from '@/db/repo/targets';
import { addIp, upsertWallet } from '@/db/repo/intel';
import { isFullWalletAddress } from '@/logic/wallets';
import { Screen } from '@/ui/components';
import { emptyTargetForm, TargetForm, type TargetFormValues } from '@/ui/TargetForm';

export default function NewTargetScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (values: TargetFormValues) => {
    const ip = values.ip.trim();
    const wallet = values.wallet.trim();
    setBusy(true);
    try {
      // Warn rather than silently create a second target for the same IP.
      const existing = await findTargetByName(db, ip);
      if (existing) {
        Alert.alert(
          'Already tracked',
          `You already have a target at ${existing.name}. Open it instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open it',
              onPress: () => router.replace(`/target/${existing.id}`),
            },
          ],
        );
        return;
      }

      const id = await createTarget(db, {
        name: ip,
        device: values.device,
        level: Number(values.level) || 0,
        activity: values.activity,
        notes: values.notes,
      });

      // Also record the IP relation so the log parser can resolve this address later.
      await addIp(db, { targetId: id, address: ip, status: 'ACTIVE', source: 'MANUAL' });

      if (wallet.length > 0) {
        // A full address is only visible once a wallet is cracked, so treat it as
        // proof; upsertWallet stores the shortened form either way.
        await upsertWallet(db, {
          displayAddress: wallet,
          targetId: id,
          fullAddress: isFullWalletAddress(wallet) ? wallet : null,
        });
      }

      router.replace(`/target/${id}`);
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TargetForm
        initial={emptyTargetForm}
        submitLabel="Create target"
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        busy={busy}
        showWallet
      />
    </Screen>
  );
}
