export type OnDoneCallback = (result: TaskCompleted) => void;

export interface TaskCompleted {
    id: string;
    error: boolean;
    errorMsg?: string;
}

