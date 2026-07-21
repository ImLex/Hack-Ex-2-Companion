Pod::Spec.new do |s|
  s.name           = 'HX2GameReader'
  s.version        = '1.0.0'
  s.summary        = 'Bridges the ReplayKit broadcast capture queue to JS'
  s.description    = 'App-group queue access, broadcast status and picker for the HE2 companion.'
  s.author         = 'ImLex'
  s.homepage       = 'https://github.com/ImLex/Hack-Ex-2-Companion'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
