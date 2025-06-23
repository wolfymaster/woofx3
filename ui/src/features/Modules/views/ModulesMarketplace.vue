<!-- src/views/ModulesMarketplace.vue -->
<template>
  <div class="marketplace">
    <!-- Title & Button -->
    <div class="marketplace-header">
      <h1 class="marketplace-title">Twitch Plugin Marketplace</h1>
      <button class="add-plugin-button">+ Add Plugin</button>
    </div>

    <!-- Subtext -->
    <p class="marketplace-subtitle">
      Discover and add plugins to enhance your Twitch streams - all in one place.
    </p>

    <!-- Search & Sort -->
    <div class="marketplace-controls">
      <SearchBar v-model="searchTerm" placeholder="Search plugins by name, category, or description" />
      <SortDropdown v-model="sortBy" :options="sortOptions" />
    </div>

    <!-- Table -->
    <PluginTable :plugins="filteredPlugins" @add-to-workflow="onAddPlugin" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import SearchBar from '@/components/SearchBar/SearchBar.vue';
import SortDropdown from '@/components/SortDropdown/SortDropdown.vue';
import PluginTable from '@/components/PluginTable/PluginTable.vue';

const searchTerm = ref('');
const sortBy = ref('Featured');

const sortOptions = ['Featured', 'Newest', 'Rating'];

const allPlugins = ref([
  {
    name: 'Music Requests',
    developer: 'PlayLive',
    description: 'Let viewers request songs and control playback.',
    category: 'Music',
    rating: 4.6,
    icon: 'https://placehold.co/40x40?text=🎵',
  },
  {
    name: 'Chat Overlay',
    developer: 'StreamBuddy',
    description: 'Display messages as overlays on stream.',
    category: 'Chat',
    rating: 4.8,
    icon: 'https://placehold.co/40x40?text=💬',
  },
  {
    name: 'Alerts Manager',
    developer: 'StreamerTools',
    description: 'Customize alerts for subs, follows, and donations.',
    category: 'Alerts',
    rating: 4.7,
    icon: 'https://placehold.co/40x40?text=🔔',
  },
  {
    name: 'Donation Tracker',
    developer: 'TipStream',
    description: 'Track donations in real time, set goals, and show animated progress bars on stream.',
    category: 'Donations',
    rating: 4.5,
    icon: 'https://placehold.co/40x40?text=💰',
  },
  {
    name: 'Emote Wall',
    developer: 'HypeTools',
    description: 'Display chat emotes as floating animations on-screen for hype moments.',
    category: 'Visuals',
    rating: 4.8,
    icon: 'https://placehold.co/40x40?text=🎉',
  },
  {
    name: 'Smart Chatbot Pro',
    developer: 'BotGenius',
    description: 'AI-powered chatbot for moderation, commands, and audience games. Supports custom reactions and Twitch rewards.',
    category: 'Chatbot',
    rating: 4.9,
    icon: 'https://placehold.co/40x40?text=🤖',
  },
  {
    name: 'Scene Switcher',
    developer: 'AutoScene',
    description: 'Automatically switch OBS scenes based on stream conditions, hotkeys, or triggers.',
    category: 'Automation',
    rating: 4.4,
    icon: 'https://placehold.co/40x40?text=🎬',
  },
  {
    name: 'Poll & Vote Overlay',
    developer: 'ViewerTools',
    description: 'Let your audience vote on decisions or content in real time using chat commands or overlays.',
    category: 'Engagement',
    rating: 4.6,
    icon: 'https://placehold.co/40x40?text=📊',
  }
]);

const filteredPlugins = computed(() => {
  let filtered = allPlugins.value.filter((plugin) =>
    plugin.name.toLowerCase().includes(searchTerm.value.toLowerCase())
  );

  if (sortBy.value === 'Rating') {
    filtered.sort((a, b) => b.rating - a.rating);
  }

  return filtered;
});

const onAddPlugin = (plugin: any) => {
  console.log('Added to workflow:', plugin);
};
</script>

<style scoped>
.marketplace {
  padding: var(--spacing-large);
  color: var(--color-text);
  background-color: var(--color-background);
  font-size: var(--font-size-base);
}

.marketplace-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-small);
}

.marketplace-title {
  margin-bottom: var(--spacing-medium);
  font-family: Arial, Helvetica, sans-serif;
}

.marketplace-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-medium);
  margin-bottom: var(--spacing-medium);
}

.search-container {
  flex: 1;
}

.search-placeholder {
  color: var(--color-searchbar-text);
}
.add-plugin-button {
    background-color: var(--color-button-background);
    color: white;
    padding: 12px 18px;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: var(--font-size-small);

}

</style>
