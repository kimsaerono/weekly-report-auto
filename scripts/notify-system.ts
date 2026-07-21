import { execSync } from 'child_process'
import { platform } from 'os'

export class SystemNotifier {
  private static readonly OS = platform()

  static notify(title: string, message: string): void {
    switch (this.OS) {
      case 'darwin':
        this.notifyMac(title, message)
        break
      case 'win32':
        this.notifyWindows(title, message)
        break
      case 'linux':
        this.notifyLinux(title, message)
        break
      default:
        this.notifyFallback(title, message)
    }
  }

  private static notifyMac(title: string, message: string): void {
    try {
      const script = `display notification "${this.escape(message)}" with title "${this.escape(title)}" sound name "default"`
      execSync(`osascript -e '${script}'`)
    } catch {
      this.notifyFallback(title, message)
    }
  }

  private static notifyWindows(title: string, message: string): void {
    try {
      const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("${this.escape(message)}", "${this.escape(title)}")`
      execSync(`powershell -Command "${psScript}"`)
    } catch {
      this.notifyFallback(title, message)
    }
  }

  private static notifyLinux(title: string, message: string): void {
    try {
      execSync(`notify-send "${this.escape(title)}" "${this.escape(message)}"`)
    } catch {
      this.notifyFallback(title, message)
    }
  }

  private static notifyFallback(title: string, message: string): void {
    process.stdout.write('\x07')
    console.log('\n')
    console.log('╔' + '═'.repeat(50) + '╗')
    console.log('║' + ' '.repeat(50) + '║')
    console.log('║' + this.center(title, 50) + '║')
    console.log('║' + ' '.repeat(50) + '║')
    console.log('╠' + '═'.repeat(50) + '╣')
    const lines = this.wrap(message, 48)
    for (const line of lines.slice(0, 5)) {
      console.log('║ ' + line.padEnd(48) + ' ║')
    }
    console.log('║' + ' '.repeat(50) + '║')
    console.log('╚' + '═'.repeat(50) + '╝')
    console.log('\n')
  }

  private static escape(str: string): string {
    return str.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')
  }

  private static center(str: string, width: number): string {
    const pad = Math.max(0, width - str.length)
    const left = Math.floor(pad / 2)
    return ' '.repeat(left) + str + ' '.repeat(pad - left)
  }

  private static wrap(str: string, width: number): string[] {
    const words = str.split(' ')
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      if ((current + word).length > width) {
        lines.push(current.trim())
        current = word + ' '
      } else {
        current += word + ' '
      }
    }
    if (current) lines.push(current.trim())
    return lines
  }

  static playSound(): void {
    try {
      switch (this.OS) {
        case 'darwin':
          execSync('afplay /System/Library/Sounds/Glass.aiff')
          break
        case 'win32':
          execSync('powershell -c "[System.Media.SystemSounds]::Beep.Play()"')
          break
        case 'linux':
          execSync('paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true')
          break
      }
    } catch {
      // ignore
    }
  }
}