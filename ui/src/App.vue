<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
import Header from "@/components/Header/Header.vue";


document.documentElement.setAttribute('data-theme', 'light');

</script>

<template>
  <Header />
  <div class="app-container">
    <nav class="sideNav">
      <ul>
        <li>
          <router-link to="/">Onboarding</router-link>
        </li>
        <li>
          <router-link to="/workflows">Workflows</router-link>
        </li>
        <li>
          <router-link to="/triggers">Triggers</router-link>
        </li>
        <li>
          <router-link to="/rewards/base">Rewards</router-link>
        </li>
        <li>
          <router-link to="/rewards/list">Rewards List</router-link>
        </li>
        <li>
          <router-link to="/modules/base">Modules</router-link>
        </li>
        <li>
          <router-link to="/modules/marketplace">Modules Marketplace</router-link>
        </li>
      </ul>
    </nav>
    <div class="content">

      <RouterView />
    </div>
  </div>
</template>

<style>

.app-container {
  display: flex;
  height: calc(100vh - 60px);
  background: var(--color-background);
}

.sideNav {
  width: 15%;
  padding: 1rem;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
}

.content {
  flex: 1;
  padding: 1rem;
}
</style>

