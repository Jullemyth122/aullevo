import { Image, FileType, FileText, Archive, Paperclip } from 'lucide-react';

export const FileIcon = ({ type }: { type: string }) => {
    if (type.startsWith('image/')) return <Image size={16} />;
    if (type === 'application/pdf') return <FileType size={16} />;
    if (type.includes('word') || type.includes('document')) return <FileText size={16} />;
    if (type.includes('zip') || type.includes('archive')) return <Archive size={16} />;
    return <Paperclip size={16} />;
};
