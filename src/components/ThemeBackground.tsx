import Background3D from './Background3D'
import ThemeScenes from './ThemeScenes'
import { useTheme } from '../lib/theme'

// Christmas keeps its original, untouched scene (Background3D). Every other theme gets its own scene.
// `key` forces a clean teardown + fresh canvas/WebGL context when the theme changes.
export default function ThemeBackground() {
  const theme = useTheme()
  return theme === 'christmas' ? <Background3D key="christmas" /> : <ThemeScenes key={theme} theme={theme} />
}
