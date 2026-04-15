<script setup>
import LogTradeForm from '../components/LogTradeForm.vue'
</script>

<template>
  <div class="view-container">
    <h2 class="view-title">New Journal Entry</h2>
    <LogTradeForm />
  </div>
</template>

<style scoped>
.view-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}
.view-title {
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 24px;
}
</style>
