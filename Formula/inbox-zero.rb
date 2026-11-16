# Homebrew Formula for Inbox Zero CLI

class InboxZero < Formula
  desc "CLI tool for setting up Inbox Zero - AI email assistant"
  homepage "https://www.getinboxzero.com"
  version "1.0.0-android-preview.1"
  license "AGPL-3.0-only"

  on_macos do
    on_arm do
      url "https://github.com/elie222/inbox-zero/releases/download/v1.0.0-android-preview.1/inbox-zero-darwin-arm64.tar.gz"
      sha256 "dc72768f7139cca64c3dd58c254273bc41199186d17ac78e3c9b98dfd5eb369d"

      def install
        bin.install "inbox-zero-darwin-arm64" => "inbox-zero"
      end
    end

    on_intel do
      url "https://github.com/elie222/inbox-zero/releases/download/v1.0.0-android-preview.1/inbox-zero-darwin-x64.tar.gz"
      sha256 "dcfbdf2c5b28ec16a9cdf059643c605fb2850d29961c4db0b3604951d59b631e"

      def install
        bin.install "inbox-zero-darwin-x64" => "inbox-zero"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/elie222/inbox-zero/releases/download/v1.0.0-android-preview.1/inbox-zero-linux-x64.tar.gz"
      sha256 "19c2ddb5ceb94fba5f3e5004af4db76d344c02e56154961aa6d3fdd34123db14"

      def install
        bin.install "inbox-zero-linux-x64" => "inbox-zero"
      end
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/inbox-zero --version")
  end
end
