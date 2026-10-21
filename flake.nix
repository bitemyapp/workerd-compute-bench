{
  description = "Local workerd JavaScript versus Rust/Wasm benchmarks";
  inputs.nixpkgs.url = "https://flakehub.com/f/DeterminateSystems/nixpkgs-weekly/0.1";
  outputs = { self, nixpkgs }: let
    systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
  in {
    devShells = nixpkgs.lib.genAttrs systems (system: let pkgs = import nixpkgs { inherit system; }; in {
      default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.binaryen pkgs.rustup pkgs.git ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.util-linux ];
        shellHook = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
          export WORKERD_LOADER="$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)"
        '';
      };
    });
  };
}
