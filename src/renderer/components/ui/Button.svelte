<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'destructive' | 'ghost' = 'primary';
  export let disabled = false;
  export let type: 'button' | 'submit' = 'button';
</script>

<button class="btn {variant}" {disabled} {type} on:click>
  <slot />
</button>
