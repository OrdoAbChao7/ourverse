import { createContext, useContext, type ReactNode } from 'react';
import type { Repository } from '@/data/repository';

const RepositoryContext = createContext<Repository | null>(null);

export function RepositoryProvider({ children, repository }: { children: ReactNode; repository: Repository }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): Repository {
  const repository = useContext(RepositoryContext);
  if (!repository) throw new Error('useRepository must be used inside RepositoryProvider');
  return repository;
}
