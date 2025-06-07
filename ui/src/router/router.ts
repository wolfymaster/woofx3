import { createRouter, createWebHistory } from 'vue-router';
import LandingPage from "../features/LandingPage/views/LandingPage.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/:pathMatch(.*)*',
            name: 'page',
            component: LandingPage
        },

    ]
});

export default router;