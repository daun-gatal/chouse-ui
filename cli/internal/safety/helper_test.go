package safety

import "os"

func openDevNull() (*os.File, error) {
	return os.Open(os.DevNull)
}
