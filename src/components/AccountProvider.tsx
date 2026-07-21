// Holds the account registry and decides which database file the app runs on.
// Switching the active account changes `activeAccount.dbName`; the root layout
// keys SQLiteProvider on it, so a switch remounts the whole app onto the other
// database.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  loadRegistry,
  resolveDetectedAccount,
  saveRegistry,
  switchActiveAccount,
  type AccountRegistry,
  type GameAccount,
} from '@/logic/accounts';

interface AccountContextValue {
  accounts: GameAccount[];
  activeAccount: GameAccount;
  switchAccount: (dbName: string) => void;
  /**
   * Feed a name read off the game's home screen. Returns true when this
   * switched the active database (the caller's world is about to remount).
   */
  reportDetectedAccount: (name: string) => boolean;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccounts(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccounts must be used inside AccountProvider');
  return value;
}

export function AccountProvider({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [registry, setRegistry] = useState<AccountRegistry | null>(null);
  const registryRef = useRef(registry);
  registryRef.current = registry;

  useEffect(() => {
    loadRegistry().then(setRegistry);
  }, []);

  const update = useCallback((next: AccountRegistry) => {
    setRegistry(next);
    void saveRegistry(next);
  }, []);

  const switchAccount = useCallback(
    (dbName: string) => {
      const current = registryRef.current;
      if (!current || dbName === current.activeDbName) return;
      update(switchActiveAccount(current, dbName));
    },
    [update],
  );

  const reportDetectedAccount = useCallback(
    (name: string) => {
      const current = registryRef.current;
      if (!current) return false;
      const outcome = resolveDetectedAccount(current, name, Date.now());
      update(outcome.registry);
      return outcome.switched;
    },
    [update],
  );

  if (!registry) return <>{fallback}</>;

  const activeAccount =
    registry.accounts.find((account) => account.dbName === registry.activeDbName) ??
    registry.accounts[0];

  return (
    <AccountContext.Provider
      value={{ accounts: registry.accounts, activeAccount, switchAccount, reportDetectedAccount }}
    >
      {children}
    </AccountContext.Provider>
  );
}
