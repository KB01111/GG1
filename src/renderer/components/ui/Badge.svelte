<script lang="ts">
  export let tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate' = 'slate';
</script>

<span class="badge {tone}"><slot /></span>
