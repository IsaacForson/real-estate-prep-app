<script setup lang="ts">
import type { NodeCoverage } from "~~/lib/study/coverage";
defineProps<{ rows: NodeCoverage[] }>();
</script>
<template>
  <table>
    <thead><tr><th>Exam section</th><th>Items on exam</th><th>You're solid on</th><th>Seen</th></tr></thead>
    <tbody>
      <tr v-for="r in rows" :key="r.node">
        <td>{{ r.node }} {{ r.label }}</td>
        <td>{{ r.examItems }}</td>
        <td><template v-if="r.solidItems != null"><strong>{{ r.solidItems }}</strong> of {{ r.examItems }}</template><span v-else class="muted">answer {{ Math.max(0, 3 - r.seen) }} more to find out</span></td>
        <td class="muted">{{ r.seen }} / {{ r.bankItems }}</td>
      </tr>
    </tbody>
  </table>
</template>
