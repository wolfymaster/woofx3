<template>
  <div class="workflows-page">
    <h2 class="workflows-title">Workflows</h2>
    <div class="heading-grid">
      <p class="wfcard-heading">Workflow Name</p>
      <p class="wfcard-heading"> Workflow Description</p>
    </div>
    <div class="workflows-grid">
      <wfCard
        v-for="module in processedWorkflows"
        :key="module.title"
        type="module"
        :title="module.title"
        :description="module.description"
        :tags="module.tags"
        :enabled="false"
        :show-config="true"
        :logo="module.logo"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import wfCard from '@/components/Card/Card.vue';

const rawWorkflows = [
  {
    name: 'Follow Alert Workflow',
    description: 'Automated workflow that triggers custom alerts, chat messages, and overlay animations when someone follows your channel.',
    tags: ['Alerts', 'Automation', 'Engagement'],
    logo: 'https://placehold.co/40x40?text=FA'
  },
  {
    name: 'Subscriber Welcome Flow',
    description: 'Multi-step workflow for new subscribers including welcome messages, special role assignment, and exclusive content access.',
    tags: ['Subscribers', 'Welcome', 'Roles'],
    logo: 'https://placehold.co/40x40?text=SW'
  },
  {
    name: 'Donation Celebration',
    description: 'Dynamic workflow that scales celebrations based on donation amount, from simple thank yous to elaborate animations.',
    tags: ['Donations', 'Celebration', 'Dynamic'],
    logo: 'https://placehold.co/40x40?text=DC'
  },
  {
    name: 'Raid Response System',
    description: 'Automated raid handling with welcome messages, follower goals, and special raid-only commands for incoming viewers.',
    tags: ['Raids', 'Welcome', 'Goals'],
    logo: 'https://placehold.co/40x40?text=RR'
  }
];

//Converting to structure for wfCard.vue
const processedWorkflows = rawWorkflows.map((w) => ({
  title: w.name,
  description: w.description,
  tags: w.tags.map((tag : string) => ({ title: tag })),
  logo: w.logo || 'https://placehold.co/40x40?text=MC'
}));

</script>

<style scoped>
.workflows-page {
    padding: 2rem;
    color: var(--color-text);
}

.workflows-title {
    font-size: 3rem;
    font-family: Arial, Helvetica, sans-serif;
    font-weight: bold;
    color: var(--color-primary);
    text-align: center;
}

.wfcard-heading {
    text-align: center;
    color: var(--color-subtle);
    margin-bottom: 2rem;
}

.workflows-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    justify-items: center;
}

.heading-grid {
    display: flex;
    justify-content: space-;
    align-items: center;
    margin-bottom: 1rem;
}
</style>