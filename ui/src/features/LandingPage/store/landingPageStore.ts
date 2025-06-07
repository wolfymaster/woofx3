import { atom } from 'nanostores';
type User = { name: string } | null;

interface UserStore {
    user: User;
}
export const $defaultUserStore = atom<UserStore>({
    user: null,
});

export const onLogin = () => {
    const userStore = $defaultUserStore.get();
    userStore.user = { name: 'Jimmy Bob' };
    $defaultUserStore.set({ ...userStore });
};
export const onLogout = () => {
    const userStore = $defaultUserStore.get();
    userStore.user = null;
    $defaultUserStore.set({ ...userStore });
};
export const onCreateAccount = () => {
    const userStore = $defaultUserStore.get();
    userStore.user = { name: 'Jimmy Bob' };
    $defaultUserStore.set({ ...userStore });
};