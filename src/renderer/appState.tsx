import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Project, Task } from '../shared/model';

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  error?: boolean;
}

interface AppState {
  today: string;
  projects: Project[];
  tasks: Task[];
  originalFirst: boolean;
  setOriginalFirst: (v: boolean) => void;
  project: (id: string) => Project | undefined;
  /** Replaces one task in the list after the main process changed it. */
  putTask: (t: Task) => void;
  removeTask: (id: string) => void;
  putProject: (p: Project) => void;
  reloadTasks: () => Promise<void>;
  reloadAll: () => Promise<void>;
  toast: (text: string, action?: ToastMessage['action']) => void;
  /** Runs a change and shows its error, if any, as a toast. */
  attempt: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  toastMessage: ToastMessage | null;
  dismissToast: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({
  initial,
  children,
}: {
  initial: { today: string; projects: Project[]; tasks: Task[] };
  children: ReactNode;
}) {
  const [projects, setProjects] = useState(initial.projects);
  const [tasks, setTasks] = useState(initial.tasks);
  const [today, setToday] = useState(initial.today);
  const [originalFirst, setOriginalFirst] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const show = useCallback((m: Omit<ToastMessage, 'id'>) => {
    window.clearTimeout(toastTimer.current);
    setToastMessage({ ...m, id: ++toastId.current });
    toastTimer.current = window.setTimeout(
      () => setToastMessage(null),
      m.action ? 6000 : 4200,
    );
  }, []);

  const value = useMemo<AppState>(
    () => ({
      today,
      projects,
      tasks,
      originalFirst,
      setOriginalFirst,
      project: (id) => projects.find((p) => p.id === id),
      putTask: (t) =>
        setTasks((all) =>
          all.some((x) => x.id === t.id)
            ? all.map((x) => (x.id === t.id ? t : x))
            : [...all, t],
        ),
      removeTask: (id) => setTasks((all) => all.filter((x) => x.id !== id)),
      putProject: (p) =>
        setProjects((all) =>
          all.some((x) => x.id === p.id)
            ? all.map((x) => (x.id === p.id ? p : x))
            : [...all, p],
        ),
      reloadTasks: async () => setTasks(await window.worksync.listTasks()),
      reloadAll: async () => {
        const s = await window.worksync.start();
        if (s.ok) {
          setProjects(s.projects);
          setTasks(s.tasks);
          setToday(s.today);
        }
      },
      toast: (text, action) => show({ text, action }),
      attempt: async (fn) => {
        try {
          return await fn();
        } catch (error) {
          show({
            text: error instanceof Error ? error.message : String(error),
            error: true,
          });
          return undefined;
        }
      },
      toastMessage,
      dismissToast: () => setToastMessage(null),
    }),
    [today, projects, tasks, originalFirst, toastMessage, show],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
