import { useCallback, useEffect, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { LOCAL_OWNER, deleteOwnerData, listOwnersOnDevice, type OwnerDataSummary } from '../../services/owner';
import { useT } from '../../i18n';
import { CollapsibleCard } from '../CollapsibleCard';

type Translate = ReturnType<typeof useT>['t'];

const formatBytes = (bytes: number, t: Translate) => {
    if (bytes < 1024) return t('settings.deviceData.bytes', { size: bytes });
    if (bytes < 1024 * 1024) return t('settings.deviceData.kilobytes', { size: (bytes / 1024).toFixed(1) });
    return t('settings.deviceData.megabytes', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

const ownerName = (o: OwnerDataSummary, t: Translate) =>
    o.owner === LOCAL_OWNER ? t('settings.deviceData.localOwner') : (o.email || t('settings.deviceData.anotherAccount'));

// Each account keeps its own encrypted vault, memories and link queue on this device.
// This card shows them and lets the user remove the ones they no longer need.
export function DeviceDataCard() {
    const { t } = useT();
    const [owners, setOwners] = useState<OwnerDataSummary[]>([]);

    const refresh = useCallback(() => {
        listOwnersOnDevice().then((list) => setOwners(list.sort((a, b) => Number(b.isActive) - Number(a.isActive))));
    }, []);

    useEffect(() => {
        refresh();
        const handleChange = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area === 'local') refresh();
        };
        chrome.storage?.onChanged?.addListener(handleChange);
        return () => chrome.storage?.onChanged?.removeListener(handleChange);
    }, [refresh]);

    const handleDelete = async (o: OwnerDataSummary) => {
        const confirmed = confirm(t('settings.deviceData.confirmDelete', { name: ownerName(o, t) }));
        if (!confirmed) return;
        await deleteOwnerData(o.owner);
        refresh();
    };

    const total = owners.reduce((sum, o) => sum + o.bytes, 0);

    return (
        <CollapsibleCard
            id="device-data"
            tour="device-data"
            defaultOpen={false}
            title={<><HardDrive size={12} /><span>{t('settings.deviceData.title')}</span></>}
            badge={<span style={{ flexShrink: 0, fontSize: 10, color: 'var(--av-text-muted)' }}>{t('settings.deviceData.total', { size: formatBytes(total, t) })}</span>}
        >
            <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4, marginBottom: 8 }}>
                {t('settings.deviceData.description')}
            </div>

            {owners.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--av-text-muted)' }}>{t('settings.deviceData.empty')}</div>
            )}

            {owners.map((o) => (
                <div
                    key={o.owner}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--av-border)' }}
                >
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ownerName(o, t)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {o.isActive ? t('settings.deviceData.inUse', { size: formatBytes(o.bytes, t) }) : formatBytes(o.bytes, t)}
                        </div>
                    </div>
                    {!o.isActive && (
                        <button type="button" className="av-pill av-pill--danger" onClick={() => handleDelete(o)} title={t('settings.deviceData.deleteTitle')}>
                            <Trash2 size={11} />
                            <span>{t('settings.deviceData.delete')}</span>
                        </button>
                    )}
                </div>
            ))}
        </CollapsibleCard>
    );
}
