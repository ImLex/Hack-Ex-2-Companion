// No explicit rescore needed here: updateTargetInfo() recalculates as part of the write.

import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '@/db/useQuery';
import { getTargetWithDetails, updateTarget, updateTargetInfo } from '@/db/repo/targets';
import { addIp } from '@/db/repo/intel';
import { EmptyState, Loading, Screen } from '@/ui/components';
import { TargetForm, type TargetFormValues } from '@/ui/TargetForm';

export default function EditTargetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const { data, loading } = useQuery(
    (database) => getTargetWithDetails(database, targetId),
    [targetId],
  );

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Screen>
        <EmptyState title="Target not found" message="It may have been deleted." />
      </Screen>
    );
  }

  const initial: TargetFormValues = {
    ip: data.target.name,
    device: data.target.device ?? '',
    level: String(data.info.level),
    // Wallets are managed on the target's own screen, not here.
    wallet: '',
    activity: data.info.activity,
    notes: data.info.notes,
  };

  const handleSubmit = async (values: TargetFormValues) => {
    setBusy(true);
    try {
      await updateTarget(db, targetId, {
        name: values.ip,
        device: values.device,
      });
      await updateTargetInfo(db, targetId, {
        level: Number(values.level) || 0,
        activity: values.activity,
        notes: values.notes,
      });

      // Teach the parser the new address too. The old IP row stays: a stale IP
      // is history, not a mistake.
      const ip = values.ip.trim();
      if (ip.length > 0 && ip !== data.target.name) {
        await addIp(db, { targetId, address: ip, status: 'ACTIVE', source: 'MANUAL' });
      }
      router.back();
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TargetForm
        initial={initial}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        busy={busy}
      />
    </Screen>
  );
}
