import { useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '@/ui/components';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        title="That screen does not exist"
        message="The link you followed points at a page Hack EX 2 Companion does not have."
        action={<Button label="Go to the dashboard" onPress={() => router.replace('/')} />}
      />
    </Screen>
  );
}
