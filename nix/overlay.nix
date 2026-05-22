# Adds anywhen's leaf packages to nixpkgs so callPackage can auto-inject them.
final: _prev:
{
  anywhen-kolu-surface = final.callPackage ./packages/surface { };
}
