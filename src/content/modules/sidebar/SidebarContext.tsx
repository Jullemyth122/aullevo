/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, ReactNode } from 'react';
import { useSidebarState, SidebarState } from './useSidebarState';

const SidebarContext = createContext<SidebarState | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
    const state = useSidebarState();
    return (
        <SidebarContext.Provider value={state}>
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar(): SidebarState {
    const context = useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within a SidebarProvider');
    }
    return context;
}
