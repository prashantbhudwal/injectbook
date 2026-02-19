class Injectbook < Formula
  desc "Convert books into Codex-compatible skills with Calibre"
  homepage "https://github.com/prashantbhudwal/injectbook"
  version "0.5.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/prashantbhudwal/injectbook/releases/download/v0.5.0/injectbook-v0.5.0-darwin-arm64.tar.gz"
      sha256 "b835b9e49894bd03ab7033b868d123f70bef08243c0f1e3272478938e3f379ce"
    else
      url "https://github.com/prashantbhudwal/injectbook/releases/download/v0.5.0/injectbook-v0.5.0-darwin-amd64.tar.gz"
      sha256 "5213f39a24a20d417c8eb53914a4f99da7c54d5d85a328fc2a7e6e79aa54c0d9"
    end
  end

  def install
    bin.install "injectbook"
  end

  def caveats
    <<~EOS
      injectbook uses Calibre to normalize ebook inputs before extraction.
      Install Calibre via Homebrew cask:
        brew install --cask calibre
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/injectbook --version")
  end
end
