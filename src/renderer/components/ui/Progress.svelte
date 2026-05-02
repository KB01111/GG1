<script lang="ts">
  export let value = 0;
  export let max = 100;
  $: percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  $: clampedValue = Math.max(0, Math.min(value, max > 0 ? max : 0));
</script>

<div class="progress" aria-valuemin="0" aria-valuemax={max} aria-valuenow={clampedValue} role="progressbar">
  <div class="progress-bar" style={`width: ${percent}%`} />
</div>
