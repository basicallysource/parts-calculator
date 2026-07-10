<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

	let { url, color = '#0055bf' }: { url: string; color?: string } = $props();

	let host: HTMLDivElement;
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let material: THREE.MeshStandardMaterial | undefined;

	// re-tint live when the color prop changes
	$effect(() => {
		material?.color.set(color);
	});

	onMount(() => {
		const el = host;
		const scene = new THREE.Scene();
		scene.background = null;

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(window.devicePixelRatio);
		el.appendChild(renderer.domElement);

		scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.1));
		const key = new THREE.DirectionalLight(0xffffff, 1.4);
		key.position.set(1, 1.4, 1.2);
		scene.add(key);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;

		function resize() {
			const w = el.clientWidth || 1;
			const h = el.clientHeight || 1;
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		}

		let mesh: THREE.Mesh | undefined;
		new STLLoader().load(
			url,
			(geo) => {
				geo.computeVertexNormals();
				geo.center();
				material = new THREE.MeshStandardMaterial({
					color: new THREE.Color(color),
					metalness: 0.0,
					roughness: 0.75,
					flatShading: false
				});
				mesh = new THREE.Mesh(geo, material);
				// STL is Z-up; rotate to Y-up for a natural view
				mesh.rotation.x = -Math.PI / 2;
				scene.add(mesh);

				const box = new THREE.Box3().setFromObject(mesh);
				const size = box.getSize(new THREE.Vector3());
				const center = box.getCenter(new THREE.Vector3());
				mesh.position.sub(center);
				const radius = Math.max(size.x, size.y, size.z);
				camera.position.set(radius * 1.1, radius * 0.9, radius * 1.4);
				controls.target.set(0, 0, 0);
				controls.update();
				status = 'ready';
			},
			undefined,
			() => (status = 'error')
		);

		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(el);

		let raf = 0;
		function loop() {
			controls.update();
			renderer.render(scene, camera);
			raf = requestAnimationFrame(loop);
		}
		loop();

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			controls.dispose();
			renderer.dispose();
			mesh?.geometry.dispose();
			renderer.domElement.remove();
		};
	});
</script>

<div class="relative h-[48vh] w-full bg-[var(--color-bg)]">
	<div bind:this={host} class="h-full w-full"></div>
	{#if status !== 'ready'}
		<div class="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
			{status === 'error' ? 'Could not load model.' : 'Loading 3D model…'}
		</div>
	{/if}
	<div class="pointer-events-none absolute bottom-2 left-3 text-xs text-text-muted">
		drag to rotate · scroll to zoom
	</div>
</div>
