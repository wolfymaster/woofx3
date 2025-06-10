import { createRouter, createWebHistory } from 'vue-router';
import LandingPage from "../features/LandingPage/views/LandingPage.vue";
import Modules from "../features/Modules/views/Modules.vue";
import ModulesMarketplace from "../features/Modules/views/ModulesMarketplace.vue";
import Rewards from "../features/Rewards/views/Rewards.vue";
import ListRewards from "../features/Rewards/views/ListRewards.vue";
import Workflows from "../features/Workflows/views/Workflows.vue";
import Triggers from "../features/Triggers/views/Triggers.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/workflows',
            name: 'Workflows',
            component: Workflows
        },
        {
            path: '/modules/base',
            name: 'Modules',
            component: Modules
        },
        {
            path: '/modules/marketplace',
            name: 'Modules Marketplace',
            component: ModulesMarketplace
        },
        {
            path: '/rewards/base',
            name: 'Rewards',
            component: Rewards
        },
        {
            path: '/rewards/list',
            name: 'Rewards List',
            component: ListRewards
        },
        {
            path: '/triggers',
            name: 'Triggers',
            component: Triggers
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'Onboarding',
            component: LandingPage
        },

    ]
});

export default router;