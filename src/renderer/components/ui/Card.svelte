<script lang="ts">
  export let title = '';
  export let description = '';
</script>

<section class="card">
  {#if title || description}
    <header class="card-header">
      {#if title}<h2>{title}</h2>{/if}
      {#if description}<p>{description}</p>{/if}
    </header>
  {/if}
  <slot />
</section>
