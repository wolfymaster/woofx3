<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
import Header from "@/components/Header/Header.vue";
import "@/style.css";


document.documentElement.setAttribute('data-theme', 'light');

</script>

<template>
  <Header />
  <div class="app-container">
    <nav class="sideNav">
      <div>
        <ul>
          <li>
            <router-link to="/home">Home</router-link>
          </li>
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
      </div>
      <div>
        <ul>
          <li>
            <router-link to="/settings">Settings</router-link>
          </li>
          <li>
            <router-link to="/feedback">Submit Feedback</router-link>
          </li>
        </ul>
      </div>

    </nav>
    <div class="content">

      <RouterView />
    </div>
  </div>
</template>

<style>

.app-container {
  display: flex;
  /* height: calc(100vh - 60px); */
  background: var(--color-background);
}

.sideNav {
  width: 15%;
  padding: 1rem;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.content {
  flex: 1;
  /* padding: 1rem; */
}
</style>

