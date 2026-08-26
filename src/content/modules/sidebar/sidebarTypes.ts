export type Tab = 'fill' | 'profile' | 'knowledge' | 'links' | 'settings';

export interface FillStatus {
    message: string;
    type: 'idle' | 'scanning' | 'filling' | 'success' | 'error' | 'info';
}

export { migrateCustomFields } from '../../../utils/customFields';
export { createEmptyUserData } from '../../../types';

export const fileSizeStr = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
