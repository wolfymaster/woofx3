<template>
  <div class="modules-page">
    <h2 class="modules-title">Featured Cards</h2>
    <p class="modules-subtitle">
      A collection of modern cards styled to match your StreamSuite mockup palette.
    </p>
    <div class="modules-grid">
      <ModuleCard
        v-for="module in processedModules"
        :key="module.title"
        type="module"
        :title="module.title"
        :description="module.description"
        :tags="module.tags"
        :enabled="false"
        :show-config="true"
        logo="https://placehold.co/40x40?text=MC"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ModuleCard from '@/components/Card/Card.vue';

const rawModules = [
  {
    name: 'Overlay Builder',
    description:
      'Design unlimited overlays and alerts with real-time preview. Drag, drop, and style your stream elements easily.',
    tags: ['Unlimited', 'Live Preview'],
     logo: 'https://placehold.co/40x40?text=OB'
  },
  {
    name: 'Event Automation',
    description:
      'Trigger custom actions for follows, subs, and donations. Automate your stream and keep chat engaged.',
    tags: ['Custom', 'Realtime']
  },
  {
    name: 'Analytics Panel',
    description:
      'Track your stream’s growth with live stats, event history, and actionable insights directly in your dashboard.',
    tags: ['Insights', 'Live Data']
  },
  {
    name: 'Chat Command Center',
    description:
      'Create and manage chat commands for your Twitch stream. Includes cooldowns, aliases, and variables.',
    tags: ['Moderation', 'Commands']
  },
  {
    name: 'Giveaway Manager',
    description:
      'Run viewer giveaways with entry tracking, eligibility filters, and automatic winner selection.',
    tags: ['Engagement', 'Randomizer']
  },
  {
    name: 'Stream Schedule Widget',
    description:
      'Display your upcoming stream schedule in real-time with timezone support and custom styling.',
    tags: ['Schedule', 'Widget']
  }
];

// Convert to proper structure for Card.vue
const processedModules = rawModules.map((m) => ({
  title: m.name,
  description: m.description,
  tags: m.tags.map((tag) => ({ title: tag }))
}));
</script>

<style scoped>
.modules-page {
  padding: 2rem;
  color: var(--color-text);
}

.modules-title {
  font-size: 3rem;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
  color: var(--color-primary);
  text-align: center;
}

.modules-subtitle {
  text-align: center;
  color: var(--color-subtle);
  margin-bottom: 2rem;
}

.modules-grid {
 display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  justify-items: center;
}
</style>
