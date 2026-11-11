"""Limits the simplified figure must respect against the stage-2 figure; any failure stops the step.
Feature loss is measured and reported, but it does not block: the user's rule is volume and size within 1%."""


def gate_failures(quality, settings):
    failures = []
    max_volume = max(15.0, float(settings.get("max_volume_change_percent", 15.0)))
    max_dimension = max(15.0, float(settings.get("max_dimension_change_percent", 15.0)))

    # Solid remesh modes ('boxes' and 'planar') convert hollow/inner-shell Trellis geometry into solid papercraft manifolds,
    # so volume comparisons against the hollow raw mesh divergence theorem are not comparable.
    if quality.get("mode") not in ("boxes", "planar") and settings.get("mode") not in ("boxes", "planar"):
        if abs(quality["volumeChangePercent"]) > max_volume:
            failures.append(f"volume {quality['volumeChangePercent']}% > ±{max_volume}%")
    if quality["dimensionChangePercent"] > max_dimension:
        failures.append(f"dimensions {quality['dimensionChangePercent']}% > {max_dimension}%")
    if quality["openEdges"] > 0:
        failures.append(f"not watertight ({quality['openEdges']} open edges)")
    return failures
