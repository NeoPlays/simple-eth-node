<template>
  <main class="base-container">
    <RouterView />
  </main>
</template>
<style scoped>
/*https://coolors.co/94c5cc-b4d2e7-a1a6b4-30343f-3d4250*/
.base-container {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    width: 100vw;
    background-color: #30343f;
    font-family: 'Courier New', Courier, monospace;
    color: black;
    gap: 20px;
}
</style>
