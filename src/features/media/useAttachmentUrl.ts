import { useEffect, useState } from 'react';
import { useRepository } from '@/app/RepositoryContext';
import { errorMessage } from '@/domain/errors';

export function useAttachmentUrl(attachmentId: string | null | undefined): {
  url: string | null;
  error: string | null;
  loading: boolean;
} {
  const repo = useRepository();
  const [state, setState] = useState<{ url: string | null; error: string | null; loading: boolean }>({
    url: null,
    error: null,
    loading: Boolean(attachmentId),
  });

  useEffect(() => {
    if (!attachmentId) {
      setState({ url: null, error: null, loading: false });
      return;
    }
    let active = true;
    setState({ url: null, error: null, loading: true });
    repo
      .getAttachmentUrl(attachmentId)
      .then((url) => {
        if (active) setState({ url, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (active) setState({ url: null, error: errorMessage(error, '无法读取这个附件。'), loading: false });
      });
    return () => {
      active = false;
    };
  }, [repo, attachmentId]);

  return state;
}
