<script setup lang="ts">
import { RouterView } from 'vue-router';
import Header from "@/components/Header/Header.vue";
</script>

<template>
  <Header />
  <div class="app-container">
    <nav class="sideNav">
      <ul>
        <li>onboarding</li>
        <li>workflows</li>
        <li>triggers</li>
      </ul>
    </nav>
    <div class="content">

      <RouterView />
    </div>
  </div>
</template>

<style>
header {
  width: 100%;
}

.app-container {
  display: flex;
  height: calc(100vh - 60px);
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

