{{- define "auth-service.fullname" -}}
{{- printf "%s-auth-service" .Release.Name -}}
{{- end -}}

{{- define "auth-service.labels" -}}
app.kubernetes.io/name: auth-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "auth-service.selectorLabels" -}}
app.kubernetes.io/name: auth-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
