import { createRouter, createWebHistory } from 'vue-router';
import LandingPage from "../features/LandingPage/views/LandingPage.vue";
import Modules from "../features/Modules/views/Modules.vue";
import ModulesMarketplace from "../features/Modules/views/ModulesMarketplace.vue";
import Rewards from "../features/Rewards/views/Rewards.vue";
import ListRewards from "../features/Rewards/views/ListRewards.vue";
import Workflows from "../features/Workflows/views/Workflows.vue";
import Triggers from "../features/Triggers/views/Triggers.vue";
import Settings from "../features/Settings/views/Settings.vue";
import SubmitFeedback from "../features/Feedback/views/SubmitFeedback.vue";
import Home from "../features/Home/views/Home.vue";

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
            path: '/settings',
            name: 'Settings',
            component: Settings
        },
        {
            path: '/feedback',
            name: 'Submit Feedback',
            component: SubmitFeedback
        },
        {
            path: '/home',
            name: 'Home',
            component: Home
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'Onboarding',
            component: LandingPage
        },

    ]
});

export default router;