/** CSS-only decoration; activity is controlled by the input or operation state. */
export function BorderBeam({ active = false }: { active?: boolean }) {
  return (
    <span aria-hidden="true" data-slot="border-beam" data-active={active} className="border-beam" />
  );
}
