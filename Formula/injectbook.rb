class Injectbook < Formula
  desc "Convert books into Codex-compatible skills with Calibre"
  homepage "https://github.com/prashantbhudwal/injectbook"
  version "0.4.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/prashantbhudwal/injectbook/releases/download/v0.4.0/injectbook-v0.4.0-darwin-arm64.tar.gz"
      sha256 "51e5173701b65b73bcc14ac5bf530e90d34574e9a6eaf7b3e6c5420b8342fcc6"
    else
      url "https://github.com/prashantbhudwal/injectbook/releases/download/v0.4.0/injectbook-v0.4.0-darwin-amd64.tar.gz"
      sha256 "641e6f942bae2a29fd92c814d84580fb04fae3ce5527796dffa72bd86d05620a"
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
